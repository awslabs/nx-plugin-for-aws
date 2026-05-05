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
  installPackagesTask,
  joinPathFragments,
  readNxJson,
  updateJson,
  updateNxJson,
} from '@nx/devkit';
import { NxGeneratorInfo, getGeneratorInfo } from '../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import { formatFilesInSubtree } from '../utils/format';
import { getPackageManagerDisplayCommands } from '../utils/pkg-manager';
import { withVersions } from '../utils/versions';
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
import { SYNC_GENERATOR_NAME as TS_SYNC_GENERATOR_NAME } from '../ts/sync/generator';

const WORKSPACES = ['packages/*'];
const NX_TYPESCRIPT_SYNC_GENERATOR = '@nx/js:typescript-sync';

// Built dependencies the generated workspace expects pnpm to run install
// scripts for. `onlyBuiltDependencies` is the pnpm 10 key (silently ignored
// by pnpm 11); pnpm 11 reads `allowBuilds` instead. We also emit a
// `.pnpmfile.cjs` (see setUpWorkspaces below) that forces
// `dangerouslyAllowAllBuilds` under pnpm 11 — without that hook, pnpm 11's
// default `strictDepBuilds=true` will rewrite pnpm-workspace.yaml with
// "set this to true or false" placeholders for any build dep a subsequent
// generator pulls in and then hard-error out of the install.
const PNPM_BUILT_DEPENDENCIES = ['@swc/core', 'esbuild', 'nx', 'sharp'];

export const PRESET_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const setUpWorkspaces = (tree: Tree) => {
  if (detectPackageManager() === 'pnpm') {
    tree.write(
      'pnpm-workspace.yaml',
      [
        'packages:',
        ...WORKSPACES.map((workspace) => `  - '${workspace}'`),
        'allowBuilds:',
        ...PNPM_BUILT_DEPENDENCIES.map((dep) => `  '${dep}': true`),
        'onlyBuiltDependencies:',
        ...PNPM_BUILT_DEPENDENCIES.map((dep) => `  - '${dep}'`),
        '',
      ].join('\n'),
    );
    // A .pnpmfile.cjs hook that forces `dangerouslyAllowAllBuilds` on every
    // pnpm install. The equivalent yaml entry gets scrubbed out of
    // pnpm-workspace.yaml on subsequent installs (and Nx's generators
    // sometimes rewrite the file via a different yaml serializer that
    // doesn't round-trip unknown keys), so setting it via the config hook
    // is the only place it survives reliably. The hook is a silent no-op
    // under pnpm 10, which doesn't read the config.
    tree.write(
      '.pnpmfile.cjs',
      [
        '/**',
        ' * Forces `dangerouslyAllowAllBuilds` for every pnpm 11 install so',
        ' * dependencies with postinstall scripts (nx, esbuild, @swc/core,',
        ' * sharp, etc.) do not cause `ERR_PNPM_IGNORED_BUILDS` when they are',
        ' * introduced by a subsequent generator. Match pnpm 10 default',
        ' * behaviour. No-op under pnpm 10.',
        ' */',
        'module.exports = {',
        '  hooks: {',
        '    updateConfig(config) {',
        '      return Object.assign(config, { dangerouslyAllowAllBuilds: true });',
        '    },',
        '  },',
        '};',
        '',
      ].join('\n'),
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
  { addTsPlugin, iacProvider }: PresetGeneratorSchema,
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

  // Write IaC provider to plugin config
  await ensureAwsNxPluginConfig(tree);
  await updateAwsNxPluginConfig(tree, { iac: { provider: iacProvider } });

  await initGenerator(tree, {
    formatter: 'prettier',
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
      build: 'nx run-many --target build',
      lint: 'nx run-many --target lint --configuration=fix',
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
      // Pin TypeScript 6 and a compatible typescript-eslint version
      ...withVersions(['typescript', 'typescript-eslint']),
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

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default presetGenerator;
