/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, logger, type Tree, updateJson } from '@nx/devkit';
import { readFileSync } from 'fs';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from './declared-dependencies.js';
import { addDependenciesToPackageJson } from './dependencies.js';
import { type ITsDepVersion, withVersions } from './versions.js';

/** Dependencies a caller must declare to set up git-secrets. */
export const GIT_SECRETS_DEPENDENCIES = [
  { name: 'husky' },
] as const satisfies readonly { name: ITsDepVersion }[];

/** The vended script, which the husky pre-commit hook runs. */
export const GIT_SECRETS_SCRIPT = '.git-secrets/git-secrets';

const HUSKY_PRE_COMMIT = '.husky/pre-commit';

/**
 * Patterns allowed so a generated workspace commits cleanly, matched against
 * `<path>:<line>:<content>`. Only the vended script, whose body contains the
 * patterns it registers.
 */
export const GIT_SECRETS_ALLOWED = ['\\.git-secrets/git-secrets:'];

/**
 * Vend the git-secrets pre-commit hook: the script itself, the husky hook that
 * runs it, and the allowlist.
 *
 * Re-runnable. The vendored script is always rewritten so an upgrade picks up a
 * newer copy, while everything a user owns is preserved: `.gitallowed` only
 * gains the entries a generated workspace needs, and an existing `pre-commit`
 * hook or `prepare` script is left alone and reported rather than replaced.
 */
export const setUpGitSecrets = <const D extends DependencyDeclaration>(
  tree: Tree,
  declaration: D & MustDeclare<typeof GIT_SECRETS_DEPENDENCIES, D>,
) => {
  const filesDir = joinPathFragments(
    import.meta.dirname,
    '..',
    'preset',
    'git-secrets-files',
  );

  tree.write(
    GIT_SECRETS_SCRIPT,
    readFileSync(
      joinPathFragments(filesDir, 'git-secrets-dir', 'git-secrets'),
      'utf-8',
    ),
  );

  const hook = readFileSync(
    joinPathFragments(filesDir, 'husky-dir', 'pre-commit'),
    'utf-8',
  );
  const existingHook = tree.read(HUSKY_PRE_COMMIT, 'utf-8');
  if (existingHook === null) {
    tree.write(HUSKY_PRE_COMMIT, hook);
  } else if (!existingHook.includes(GIT_SECRETS_SCRIPT)) {
    logger.warn(
      `Your ${HUSKY_PRE_COMMIT} was left as-is. To scan staged files for AWS credentials, add:\n\n${hook}`,
    );
  }

  // Preserve any entries the user has added, appending only the ones missing.
  const existingAllowed =
    tree
      .read('.gitallowed', 'utf-8')
      ?.split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line !== '') ?? [];
  const allowed = [
    ...existingAllowed,
    ...GIT_SECRETS_ALLOWED.filter(
      (pattern) => !existingAllowed.includes(pattern),
    ),
  ];
  tree.write('.gitallowed', `${allowed.join('\n')}\n`);

  updateJson(tree, 'package.json', (json) => {
    const prepare: string | undefined = json.scripts?.prepare;
    if (prepare !== undefined && !prepare.includes('husky')) {
      logger.warn(
        `Your \`prepare\` script was left as-is. Git hooks are installed by husky, so add \`husky\` to it for the pre-commit hook to run.`,
      );
    }
    return {
      ...json,
      scripts: { ...json.scripts, prepare: prepare ?? 'husky' },
    };
  });

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(
      forDependencies<typeof GIT_SECRETS_DEPENDENCIES>(declaration),
      ['husky'],
    ),
  );
};
