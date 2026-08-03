/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../test';
import { BASE_IMAGES, TS_VERSIONS } from '../versions';
import { ownedDependencies, ownedForFile } from './owned-dependencies';
import { isDockerfile } from './sync-embedded-versions';
import { syncVendedVersions } from './sync-vended-versions';

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..', '..');

/**
 * Every vended pin a template's text carries, whether it is substituted through
 * an EJS var or written as a literal.
 *
 * Scanning the literals matters as much as the vars: `build.Dockerfile` pins
 * `rolldown@1.0.0-beta.38` with no EJS at all, so a check keyed only on var names
 * is blind to it — which is exactly how it went unowned.
 */
const vendedPinsIn = (contents: string): string[] => {
  const found = new Set<string>();
  for (const name of Object.keys(TS_VERSIONS)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // An install pin, either literal or EJS-substituted.
    if (
      new RegExp(
        `npm (?:install|i|add)[^\\n]*?\\s${escaped}@(?:[0-9]|<%)`,
      ).test(contents) ||
      new RegExp(`overrides\\.${escaped}=`).test(contents)
    ) {
      found.add(name);
    }
  }
  return [...found];
};

/** Every template file under the plugin's source tree. */
const templateFiles = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.template')) {
        found.push(path.relative(PLUGIN_SRC, full));
      }
    }
  };
  walk(PLUGIN_SRC);
  return found;
};

/**
 * The generator whose `files/` directory a template lives under, as the id its
 * metadata records. `src/ts/agent/files/...` belongs to `ts#agent`.
 */
const owningGeneratorId = (rel: string): string | undefined => {
  const segments = rel.split('/');
  const filesAt = segments.indexOf('files');
  if (filesAt < 1) {
    return undefined;
  }
  const parts = segments.slice(0, filesAt);
  // `utils/...` templates are written by a helper on another generator's behalf,
  // so they have no single owner to resolve.
  if (parts[0] === 'utils') {
    return undefined;
  }
  return parts.join('#');
};

// A pin is only synced when the project the emitted file lands in owns it. A
// template can therefore vend a pin that no generator declares — the file is
// visited, the shape matches, and the version is still left behind. This is the
// assertion that catches that, and it is what `rolldown` in the smithy
// `build.Dockerfile` slipped past.
describe('template pin ownership', () => {
  it('should have the owning generator declare every vended pin its templates emit', async () => {
    const tree: Tree = createTreeUsingTsSolutionSetup();
    // One project per generator that owns a pin-bearing template, rooted where
    // that generator would put it.
    const projects = new Map<string, string>();
    for (const rel of templateFiles()) {
      const emitted = path.basename(rel).replace(/\.template$/, '');
      if (!isDockerfile(emitted)) {
        continue;
      }
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
      if (vendedPinsIn(contents).length === 0) {
        continue;
      }
      const generatorId = owningGeneratorId(rel);
      if (generatorId) {
        projects.set(generatorId, `packages/${generatorId.replace(/#/g, '-')}`);
      }
    }
    for (const [generatorId, root] of projects) {
      addProjectConfiguration(tree, root.replace(/\//g, '-'), {
        root,
        metadata: { generator: generatorId, iac: 'terraform' } as never,
      });
    }

    const owned = await ownedDependencies(tree);
    const unowned: string[] = [];

    for (const rel of templateFiles()) {
      const emitted = path.basename(rel).replace(/\.template$/, '');
      if (!isDockerfile(emitted)) {
        continue;
      }
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
      const generatorId = owningGeneratorId(rel);
      if (!generatorId) {
        continue;
      }
      const root = projects.get(generatorId);
      if (!root) {
        continue;
      }
      const scoped = ownedForFile(owned, `${root}/${emitted}`);
      for (const name of vendedPinsIn(contents)) {
        if (!scoped.ts.has(name)) {
          unowned.push(`${rel}: ${generatorId} does not own ${name}`);
        }
      }
    }

    expect(unowned).toEqual([]);
  });

  // The base image a runtime `FROM` pins is synced, so a template pinning a
  // different tag of the same repository would be silently rewritten to it. A
  // build stage is exempt: it names itself and needs its own tag.
  it('should not pin a non-vended tag of a vended base image repository', () => {
    const repositories = Object.values(BASE_IMAGES).map((image) =>
      image.slice(0, image.lastIndexOf(':')),
    );
    const conflicting: string[] = [];

    for (const rel of templateFiles()) {
      const contents = fs.readFileSync(path.join(PLUGIN_SRC, rel), 'utf-8');
      for (const line of contents.split('\n')) {
        const from = /^FROM (\S+):(\S+)(\s+AS\s+\S+)?\s*$/.exec(line.trim());
        if (!from) {
          continue;
        }
        const [, repository, tag, stage] = from;
        if (!repositories.includes(repository) || stage) {
          continue;
        }
        const vendedTag = Object.values(BASE_IMAGES)
          .find((image) => image.startsWith(`${repository}:`))
          ?.slice(repository.length + 1);
        // A literal tag is fine only if it is the one this release vends; an EJS
        // substitution renders to it by construction.
        if (!tag.startsWith('<%') && tag !== vendedTag) {
          conflicting.push(`${rel}: FROM ${repository}:${tag}`);
        }
      }
    }

    expect(conflicting).toEqual([]);
  });
});

// The smithy `build.Dockerfile` is the one template whose pins are all literals,
// and it carries both a package pin the sync must move and a build-stage base
// image it must not touch. Run the migration over the real file to hold both at
// once — a rewritten builder base swaps in a slim image without curl or unzip,
// which fails the build with exit 127.
describe('the real smithy build.Dockerfile', () => {
  const TEMPLATE = path.join(
    PLUGIN_SRC,
    'smithy/project/files/service/build.Dockerfile.template',
  );

  it('should sync its package pins and leave its builder base image alone', async () => {
    const tree: Tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'api-model', {
      root: 'packages/api/model',
      metadata: { generator: 'smithy#project' } as never,
    });
    // Written verbatim: this template substitutes nothing.
    const original = fs.readFileSync(TEMPLATE, 'utf-8');
    tree.write('packages/api/model/build.Dockerfile', original);

    await syncVendedVersions(tree);

    const synced = tree.read('packages/api/model/build.Dockerfile', 'utf-8')!;
    expect(synced).toContain(`rolldown@${TS_VERSIONS.rolldown}`);
    // The builder stage keeps the tag it chose, and the runtime tag never
    // reaches this file.
    expect(synced).toContain('node:24 AS builder');
    expect(synced).not.toContain(BASE_IMAGES.node);
    // Everything else is untouched.
    expect(
      synced.replace(`rolldown@${TS_VERSIONS.rolldown}`, 'rolldown@X'),
    ).toEqual(original.replace(/rolldown@[^\s]+/, 'rolldown@X'));
  });
});
