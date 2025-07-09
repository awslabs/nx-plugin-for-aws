/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  addDependenciesToPackageJson,
  detectPackageManager,
  generateFiles,
  getPackageManagerCommand,
  installPackagesTask,
  joinPathFragments,
  updateJson,
} from '@nx/devkit';
import { NxGeneratorInfo, getGeneratorInfo } from '../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import { formatFilesInSubtree } from '../utils/format';
import { initGenerator } from '@nx/js';
import { readModulePackageJson } from 'nx/src/utils/package-json';
import { getNpmScope } from '../utils/npm-scope';
import GeneratorsJson from '../../generators.json';
import { PresetGeneratorSchema } from './schema';
import { execSync } from 'child_process';
import * as enquirer from 'enquirer';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils';

const WORKSPACES = ['packages/*'];

export const PRESET_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const setUpWorkspaces = (tree: Tree) => {
  if (detectPackageManager() === 'pnpm') {
    tree.write(
      'pnpm-workspace.yaml',
      `packages:
  ${WORKSPACES.map((workspace) => `- "${workspace}"`).join('\n  ')}
`,
    );
  } else {
    updateJson(tree, 'package.json', (json) => {
      json.workspaces = WORKSPACES;
      return json;
    });
  }
};

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

export const presetGenerator = async (
  tree: Tree,
  { addTsPlugin }: PresetGeneratorSchema,
): Promise<GeneratorCallback> => {
  if (
    isAmazonian() &&
    !process.env.VITEST &&
    !process.env.CI &&
    process.env.NX_DRY_RUN !== 'true'
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

  await initGenerator(tree, {
    formatter: 'prettier',
    addTsPlugin: addTsPlugin ?? true,
  });

  tree.delete('apps/.gitkeep');
  tree.delete('libs/.gitkeep');
  tree.write('packages/.gitkeep', '');

  setUpWorkspaces(tree);

  updateJson(tree, 'package.json', (packageJson) => ({
    ...packageJson,
    type: 'module',
    scripts: {
      ...packageJson.scripts,
      'build:all': 'nx run-many --target build --all',
      'affected:all': 'nx affected --target build',
    },
  }));

  addDependenciesToPackageJson(
    tree,
    {},
    {
      '@nx/workspace': readModulePackageJson('@nx/js').packageJson.version,
    },
  );

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files'),
    '.',
    {
      projectName: getNpmScope(tree),
      generators: Object.entries(GeneratorsJson.generators)
        .filter(([_, v]) => !v['hidden'])
        .map(([k, v]) => ({ name: k, description: v.description })),
      pkgMgrCmd: getPackageManagerCommand().exec,
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [PRESET_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default presetGenerator;
