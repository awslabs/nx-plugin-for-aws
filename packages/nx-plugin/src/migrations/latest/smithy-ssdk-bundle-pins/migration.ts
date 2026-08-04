/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { SMITHY_PROJECT_GENERATOR_INFO } from '../../../smithy/project/generator';
import { applyGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { isVendedUpgrade } from '../../../utils/version-upgrade-migration/vended-upgrade';

/**
 * Move a Smithy `build.Dockerfile` onto the SSDK bundle pins this release fixes.
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

/** A pin in the file body, and the version this migration moves it to. */
interface Pin {
  /** The package as the install command names it. */
  readonly name: string;
  readonly target: string;
}

/**
 * Hardcoded rather than read from `TS_VERSIONS`: this runs once, for the release
 * that fixed the declaration naming, so it must keep applying that exact change
 * however far the vended versions move afterwards. A workspace on a later release
 * gets the newer pins from the version sync instead.
 */
const PINS: readonly Pin[] = [
  { name: 'rolldown', target: '1.2.0' },
  { name: 'rolldown-plugin-dts', target: '0.28.0' },
  { name: '@rollup/plugin-esm-shim', target: '0.1.8' },
];

/** A version ends at whitespace, a line break or the end of the command. */
const VERSION = String.raw`[^\s\\]+`;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrite every occurrence of one pin to its target version.
 *
 * The pin is matched by name, so a `rolldown-plugin-dts@x` in the same command as
 * `rolldown@y` keeps its own version — the `@` before the version terminates the
 * match, so the shorter name does not match the longer one.
 */
const rewritePin = ({ name, target }: Pin): string =>
  `r"[\\s\\S]*${escapeRegExp(name)}@(${VERSION})[\\s\\S]*"($version) where { $version => \`${target}\` }`;

/** Whether the file pins this package behind the target version. */
const isBehindTarget = (contents: string, { name, target }: Pin): boolean => {
  const matches = contents.matchAll(
    new RegExp(`${escapeRegExp(name)}@(${VERSION})`, 'g'),
  );
  const declared = [...matches].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  // A rewrite replaces every occurrence at once, so this has to hold for all of
  // them. Compared rather than tested for inequality, so a workspace a later
  // release has already moved past the target keeps its newer pin.
  return (
    declared.length > 0 &&
    declared.every((version) => isVendedUpgrade(target, version))
  );
};

const divergedNextStep = (path: string): string =>
  `${path}: the Smithy build image's bundle pins have diverged from the generated shape - left untouched. Update \`rolldown\` to 1.2.0 and \`rolldown-plugin-dts\` to 0.28.0.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  // Only a Smithy service project bundles the SSDK; the shapes type builds the
  // model alone and pins none of this.
  const buildDockerfiles = [...getProjects(tree).values()]
    .filter((project) => {
      const metadata = project.metadata as
        | { generator?: string; smithyType?: string }
        | undefined;
      return (
        metadata?.generator === SMITHY_PROJECT_GENERATOR_INFO.id &&
        metadata.smithyType === 'service'
      );
    })
    .map((project) => joinPathFragments(project.root, 'build.Dockerfile'))
    .filter((filePath) => tree.exists(filePath));

  for (const path of buildDockerfiles) {
    const contents = tree.read(path, 'utf-8') ?? '';

    for (const pin of PINS) {
      if (!isBehindTarget(contents, pin)) {
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
