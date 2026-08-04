/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { applyGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { TS_VERSIONS } from '../../../utils/versions';

/**
 * Move a Smithy `build.Dockerfile` onto the SSDK bundle pins it now vends.
 *
 * `rolldown-plugin-dts` named the bundled declaration after its content hash
 * before 0.20.0, so the generated handler's `./generated/ssdk/index.js` import
 * found no `index.d.ts` beside it and `compile` failed with TS7016. The two pins
 * move together: the plugin release that fixed the naming needs a rolldown past
 * the pin this shipped with.
 *
 * There is no Dockerfile grammar, so each pin is matched as an anchored rewrite
 * over the whole file with the version captured — `${...}` in these patterns is
 * GritQL metavariable syntax, not interpolation.
 */

/** A pin in the file body, and the version this release vends for it. */
interface Pin {
  /** The package as the install command names it. */
  readonly name: string;
  readonly vended: string;
}

const PINS: readonly Pin[] = [
  { name: 'rolldown', vended: TS_VERSIONS.rolldown },
  {
    name: 'rolldown-plugin-dts',
    vended: TS_VERSIONS['rolldown-plugin-dts'],
  },
  {
    name: '@rollup/plugin-esm-shim',
    vended: TS_VERSIONS['@rollup/plugin-esm-shim'],
  },
];

/** A version ends at whitespace, a line break or the end of the command. */
const VERSION = String.raw`[^\s\\]+`;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrite every occurrence of one pin to the vended version.
 *
 * The pin is matched by name, so a `rolldown-plugin-dts@x` in the same command
 * as `rolldown@y` keeps its own version — the longer name is not a prefix of the
 * shorter one here, since the `@` before the version terminates the match.
 */
const rewritePin = ({ name, vended }: Pin): string =>
  `r"[\\s\\S]*${escapeRegExp(name)}@(${VERSION})[\\s\\S]*"($version) where { $version => \`${vended}\` }`;

/** Whether the file pins this package at a version other than the vended one. */
const isOutOfDate = (contents: string, { name, vended }: Pin): boolean => {
  const matches = contents.matchAll(
    new RegExp(`${escapeRegExp(name)}@(${VERSION})`, 'g'),
  );
  const declared = [...matches].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  // A rewrite replaces every occurrence at once, so this has to hold for all of
  // them — a copy already on the vended version is left alone.
  return declared.length > 0 && declared.every((version) => version !== vended);
};

const divergedNextStep = (path: string): string =>
  `${path}: the Smithy build image's bundle pins have diverged from the generated shape - left untouched. Update \`rolldown\` to ${TS_VERSIONS.rolldown} and \`rolldown-plugin-dts\` to ${TS_VERSIONS['rolldown-plugin-dts']} by hand: before 0.20.0 the plugin named the bundled SSDK declaration after its content hash, so the generated handler's \`./generated/ssdk/index.js\` import fails to resolve its types with TS7016.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  const buildDockerfiles: string[] = [];

  visitNotIgnoredFiles(tree, '.', (path) => {
    if (path.split('/').pop() === 'build.Dockerfile') {
      buildDockerfiles.push(path);
    }
  });

  for (const path of buildDockerfiles) {
    const contents = tree.read(path, 'utf-8') ?? '';
    // Only the Smithy service build image bundles the SSDK; the shapes one
    // builds the model alone and pins none of this.
    if (!contents.includes('rolldown-plugin-dts@')) {
      continue;
    }

    for (const pin of PINS) {
      if (!isOutOfDate(contents, pin)) {
        continue;
      }
      if (!(await applyGritQL(tree, path, rewritePin(pin)))) {
        nextSteps.push(divergedNextStep(path));
        break;
      }
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
