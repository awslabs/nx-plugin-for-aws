/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { execSync } from 'child_process';
import enquirer from 'enquirer';
import { readFileSync } from 'fs';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils';
import { addDependenciesToPackageJson } from '../utils/dependencies';
import { formatFilesInSubtree } from '../utils/format';
import { applyWorkspaceInit } from '../utils/init';
import { installDependencies } from '../utils/install';
import { getGeneratorInfo, type NxGeneratorInfo } from '../utils/nx';
import { withVersions } from '../utils/versions';
import type { PresetGeneratorSchema } from './schema';

export const PRESET_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Determines if the current user is an Amazon employee based on their git configuration.
 *
 * This function checks the git user email configuration to identify Amazon employees
 * by looking for email addresses with Amazon domains (e.g., @amazon.com, @amazon.co.uk).
 *
 * @returns {boolean} True if the user's git email has an Amazon domain, false otherwise
 *
 * @example
 * // Returns true for Amazon employee emails
 * // git config user.email = "john.doe@amazon.com"
 * isAmazonian(); // true
 *
 * @example
 * // Returns false for non-Amazon emails
 * // git config user.email = "user@example.com"
 * isAmazonian(); // false
 *
 * @example
 * // Returns false when git config is not available or throws an error
 * isAmazonian(); // false
 */
export function isAmazonian(): boolean {
  try {
    // Execute git command to retrieve the user's configured email address
    const gitEmail = execSync('git config user.email', {
      encoding: 'utf8',
    }).trim();

    // Return false if no email is configured
    if (!gitEmail) {
      return false;
    }

    // Split email address to extract domain part
    const emailParts = gitEmail.split('@');
    if (emailParts.length < 2) {
      return false;
    }

    // Extract domain and normalize to lowercase for comparison
    const domain = emailParts[1].toLowerCase();

    // Check if domain starts with 'amazon.' (covers amazon.com, amazon.co.uk, etc.)
    return domain.startsWith('amazon.');
  } catch (error) {
    // Return false if git command fails or any other error occurs
    // This handles cases where git is not installed or configured
    return false;
  }
}

const setUpGitSecrets = (tree: Tree) => {
  const gitSecretsDir = joinPathFragments(
    import.meta.dirname,
    'git-secrets-files',
    'git-secrets-dir',
  );
  const huskyDir = joinPathFragments(
    import.meta.dirname,
    'git-secrets-files',
    'husky-dir',
  );

  tree.write(
    '.git-secrets/git-secrets',
    readFileSync(joinPathFragments(gitSecretsDir, 'git-secrets'), 'utf-8'),
  );
  tree.write(
    '.husky/pre-commit',
    readFileSync(joinPathFragments(huskyDir, 'pre-commit'), 'utf-8'),
  );
  tree.write('.gitallowed', '\\.git-secrets/git-secrets:\n');

  updateJson(tree, 'package.json', (json) => ({
    ...json,
    scripts: {
      ...json.scripts,
      prepare: 'husky',
    },
  }));

  addDependenciesToPackageJson(tree, {}, withVersions(['husky']));
};

export const presetGenerator = async (
  tree: Tree,
  {
    iac,
    gitSecrets,
    mcp,
    containers,
    module,
    preferInstallDependencies,
  }: PresetGeneratorSchema,
): Promise<GeneratorCallback> => {
  if (
    isAmazonian() &&
    !process.env.VITEST &&
    !process.env.CI &&
    process.env.NX_DRY_RUN !== 'true' &&
    process.env.NX_INTERACTIVE !== 'false'
  ) {
    const { engagementId } = await enquirer.prompt<{ engagementId?: string }>([
      {
        name: 'engagementId',
        message: 'Please enter your engagementId (if known)',
        type: 'input',
        initial: 'None',
      },
    ]);

    if (engagementId != 'None') {
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, { tags: [engagementId] });
    }
  }

  // The preset owns the greenfield workspace's module format: write the root
  // `type` explicitly from the chosen `--module` so later generators can
  // infer it. The `init` generator never touches an existing workspace's
  // `type` field.
  updateJson(tree, 'package.json', (packageJson) => ({
    ...packageJson,
    type: (module ?? 'esm') === 'esm' ? 'module' : 'commonjs',
  }));

  // Apply the deterministic workspace configuration shared with the `init`
  // generator. The preset owns the README of a greenfield workspace.
  await applyWorkspaceInit(tree, {
    iac,
    containers,
    mcp,
    readmeOverwriteStrategy: OverwriteStrategy.Overwrite,
    overwriteScripts: true,
  });

  tree.delete('apps/.gitkeep');
  tree.delete('libs/.gitkeep');
  tree.write('packages/.gitkeep', '');

  if (gitSecrets !== false) {
    setUpGitSecrets(tree);
  }

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default presetGenerator;
