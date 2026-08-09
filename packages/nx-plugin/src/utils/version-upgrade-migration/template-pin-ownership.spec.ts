/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { smithyProjectGenerator } from '../../smithy/project/generator';
import { createTreeUsingTsSolutionSetup } from '../test';
import {
  BASE_IMAGES,
  JAVA_ARTIFACTS,
  MISE_VERSIONS,
  TS_VERSIONS,
} from '../versions';
import { ownedDependencies, ownedForFile } from './owned-dependencies';
import { isDockerfile } from './sync-embedded-versions';
import { syncVendedVersions } from './sync-vended-versions';

const PLUGIN_SRC = path.resolve(import.meta.dirname, '..', '..');

/**
 * Every vended pin a template's text carries, whether it is substituted through
 * an EJS var or written as a literal.
 *
 * Scanning the literals matters as much as the vars: a template is free to write
 * a pin out in full, and a check keyed only on var names is blind to it — which
 * is how the smithy `build.Dockerfile`'s pins went unowned.
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

// A Smithy project's versions sit in two places nothing else reaches: the CLI
// pinned in its compile target command, and the Maven coordinates its
// `smithy-build.json` resolves. Neither appears in a manifest, so leaving them
// behind strands a workspace on the Smithy release it was generated with. Run the
// sync over the files the real generator renders rather than fixtures, so a
// template whose shape moves is caught here.
describe('the real smithy project pins', () => {
  // The versions an older release rendered.
  const OLD_SMITHY = '1.61.0';
  const OLD_CODEGEN = '0.34.1';

  const windBack = (contents: string): string =>
    JAVA_ARTIFACTS.reduce(
      (text, artifact) =>
        text.replace(
          new RegExp(`${artifact.replace(/[.$]/g, '\\$&')}:[^"]+`),
          `${artifact}:${
            artifact.includes('typescript') ? OLD_CODEGEN : OLD_SMITHY
          }`,
        ),
      contents,
    );

  it('should sync the smithy cli and mise pinned in the compile target', async () => {
    const tree: Tree = createTreeUsingTsSolutionSetup();
    await smithyProjectGenerator(tree, { name: 'api' });
    const path = 'api/project.json';
    const fresh = tree.read(path, 'utf-8')!;

    // Matched on the pin rather than the version rendered today, so winding back
    // keeps working as the vended version moves.
    const older = fresh
      .replace(/exec smithy@[^ ]+/, `exec smithy@${OLD_SMITHY}`)
      .replace(/mise@[^ ]+/, 'mise@2026.1.1');
    expect(older).not.toEqual(fresh);
    tree.write(path, older);

    await syncVendedVersions(tree);

    expect(tree.read(path, 'utf-8')).toEqual(fresh);
    // Both the CLI and the mise that resolves it move forward.
    expect(tree.read(path, 'utf-8')).toContain(
      `npx -y mise@${TS_VERSIONS.mise} exec smithy@${MISE_VERSIONS.smithy}`,
    );
  });

  it.each(['service', 'shapes'] as const)(
    'should sync the maven coordinates a %s smithy-build.json resolves',
    async (type) => {
      const tree: Tree = createTreeUsingTsSolutionSetup();
      await smithyProjectGenerator(tree, { name: 'api', type });
      const path = 'api/smithy-build.json';
      const fresh = tree.read(path, 'utf-8')!;

      const older = windBack(fresh);
      expect(older).not.toEqual(fresh);
      tree.write(path, older);

      await syncVendedVersions(tree);

      expect(tree.read(path, 'utf-8')).toEqual(fresh);
    },
  );

  it('should leave a coordinate the user pinned past this release alone', async () => {
    const tree: Tree = createTreeUsingTsSolutionSetup();
    await smithyProjectGenerator(tree, { name: 'api', type: 'shapes' });
    const path = 'api/smithy-build.json';
    const ahead = '9.9.9';
    tree.write(
      path,
      tree
        .read(path, 'utf-8')!
        .replace(
          /software\.amazon\.smithy:smithy-model:[^"]+/,
          `software.amazon.smithy:smithy-model:${ahead}`,
        ),
    );

    await syncVendedVersions(tree);

    expect(tree.read(path, 'utf-8')).toContain(
      `software.amazon.smithy:smithy-model:${ahead}`,
    );
  });

  // Scoped by the recorded generator id, so a smithy-build.json a user wrote in a
  // project we didn't generate keeps the coordinates they chose.
  it('should leave a smithy-build.json outside a generated project alone', async () => {
    const tree: Tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'theirs', { root: 'packages/theirs' });
    const path = 'packages/theirs/smithy-build.json';
    tree.write(
      path,
      JSON.stringify({
        version: '1.0',
        maven: { dependencies: ['software.amazon.smithy:smithy-model:1.61.0'] },
      }),
    );

    await syncVendedVersions(tree);

    // Their coordinate keeps the version they chose, not the one this release vends.
    expect(tree.read(path, 'utf-8')).toContain(
      'software.amazon.smithy:smithy-model:1.61.0',
    );
  });
});
