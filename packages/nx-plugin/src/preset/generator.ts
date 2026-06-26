/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  detectPackageManager,
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  readNxJson,
  type Tree,
  updateJson,
  updateNxJson,
} from '@nx/devkit';
import { initGenerator } from '@nx/js';
import { execSync } from 'child_process';
import * as enquirer from 'enquirer';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { readModulePackageJson } from 'nx/src/utils/package-json';
import GeneratorsJson from '../../generators.json';
import { SYNC_GENERATOR_NAME as TS_SYNC_GENERATOR_NAME } from '../ts/sync/generator';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils';
import { inferContainers } from '../utils/containers';
import { DEFAULT_BIOME_CONFIG, formatFilesInSubtree } from '../utils/format';
import { configureMcpServers } from '../utils/mcp';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import { getNpmScope } from '../utils/npm-scope';
import { getGeneratorInfo, type NxGeneratorInfo } from '../utils/nx';
import { getPackageManagerDisplayCommands } from '../utils/pkg-manager';
import { withVersions } from '../utils/versions';
import type { PresetGeneratorSchema } from './schema';

const WORKSPACES = ['packages/*'];
const NX_TYPESCRIPT_SYNC_GENERATOR = '@nx/js:typescript-sync';

// Built dependencies whose install scripts the generated workspace trusts.
// `onlyBuiltDependencies` is the pnpm 10 key (silently ignored by pnpm 11);
// pnpm 11 reads `allowBuilds` instead. Any dep NOT in this allowlist will
// have its install scripts skipped with a warning — matching pnpm 10's
// default behaviour. The user can opt-in later via `pnpm approve-builds`.
const PNPM_BUILT_DEPENDENCIES = ['@swc/core', 'esbuild', 'nx', 'sharp'];

export const PRESET_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const setUpWorkspaces = (tree: Tree) => {
  if (detectPackageManager() === 'pnpm') {
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump(
        {
          packages: WORKSPACES,
          allowBuilds: Object.fromEntries(
            PNPM_BUILT_DEPENDENCIES.map((dep) => [dep, true]),
          ),
          onlyBuiltDependencies: PNPM_BUILT_DEPENDENCIES,
        },
        { quotingType: "'" },
      ),
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

const setUpGitSecrets = (tree: Tree) => {
  const gitSecretsDir = joinPathFragments(
    __dirname,
    'git-secrets-files',
    'git-secrets-dir',
  );
  const huskyDir = joinPathFragments(
    __dirname,
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
  { addTsPlugin, iac, gitSecrets, mcp, containers }: PresetGeneratorSchema,
): Promise<GeneratorCallback> => {
  const resolvedContainers =
    !containers || containers === 'infer' ? inferContainers() : containers;
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

  // Write IaC provider and container engine to plugin config
  await ensureAwsNxPluginConfig(tree);
  await updateAwsNxPluginConfig(tree, {
    iac: { provider: iac },
    containers: { engine: resolvedContainers },
  });

  await initGenerator(tree, {
    formatter: 'none',
    addTsPlugin: addTsPlugin ?? true,
  });

  tree.delete('apps/.gitkeep');
  tree.delete('libs/.gitkeep');
  tree.write('packages/.gitkeep', '');

  setUpWorkspaces(tree);

  const nxJson = readNxJson(tree);
  updateNxJson(tree, {
    ...nxJson,
    analytics: false,
    targetDefaults: {
      ...nxJson.targetDefaults,
      compile: {
        ...nxJson.targetDefaults?.compile,
        syncGenerators: [
          ...(nxJson.targetDefaults?.compile?.syncGenerators ?? []).filter(
            (g) =>
              ![TS_SYNC_GENERATOR_NAME, NX_TYPESCRIPT_SYNC_GENERATOR].includes(
                g,
              ),
          ),
          NX_TYPESCRIPT_SYNC_GENERATOR,
          TS_SYNC_GENERATOR_NAME,
        ],
      },
    },
  });

  updateJson(tree, 'package.json', (packageJson) => ({
    ...packageJson,
    type: 'module',
    scripts: {
      ...packageJson.scripts,
      dev: 'nx run-many --target dev',
      build: 'nx run-many --target build',
      lint: 'nx run-many --target lint --configuration=fix',
      test: 'nx run-many --target test --all',
      'build:skip-lint': 'nx run-many --target build --configuration=skip-lint',
      'build:all': 'nx run-many --target build --all',
      'affected:all': 'nx affected --target build',
    },
  }));

  addDependenciesToPackageJson(
    tree,
    {},
    {
      '@nx/workspace': readModulePackageJson('@nx/js').packageJson.version,
      ...withVersions(['typescript', '@biomejs/biome']),
    },
  );

  // Write biome.json for formatting and linting
  if (!tree.exists('biome.json')) {
    tree.write('biome.json', JSON.stringify(DEFAULT_BIOME_CONFIG, null, 2));
  }

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files'),
    '.',
    {
      projectName: getNpmScope(tree),
      generators: Object.entries(GeneratorsJson.generators)
        .filter(([_, v]) => !v['hidden'])
        .map(([k, v]) => ({ name: k, description: v.description })),
      ...(() => {
        const cmds = getPackageManagerDisplayCommands();
        return {
          pkgMgrCmd: cmds.exec,
          buildCmd: `${cmds.run} build`,
          lintCmd: `${cmds.run} lint`,
        };
      })(),
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  if (gitSecrets !== false) {
    setUpGitSecrets(tree);
  }

  if (mcp !== false) {
    configureMcpServers(tree);
  }

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default presetGenerator;
