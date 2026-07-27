/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readJson,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import PackageJson from '../../../package.json' with { type: 'json' };
import { addDependenciesToPackageJson } from '../../utils/dependencies';
import { formatFilesInSubtree } from '../../utils/format';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { isEsmWorkspace } from '../../utils/module-format';
import { kebabCase } from '../../utils/names';
import {
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { withVersions } from '../../utils/versions';
import type { TsNxMigrationGeneratorSchema } from './schema';

export const NX_MIGRATION_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Scaffolds a migration in an Nx Plugin project and registers it in the
 * plugin's `migrations.json` (creating the manifest and wiring the
 * `nx-migrations` field into the plugin's `package.json` if absent), so
 * `nx migrate` applies it when users upgrade the plugin.
 *
 * Supports all three Nx 23 migration kinds:
 * - `deterministic`: a codemod (`implementation`).
 * - `agentic`: a `prompt` markdown file applied by the user's agent.
 * - `hybrid`: both — the codemod does the mechanical part and returns
 *   `agentContext`, then the prompt hands off to the agent for the rest.
 *
 * No `version` is written — the plugin author stamps versions at release time.
 */
export const tsNxMigrationGenerator = async (
  tree: Tree,
  options: TsNxMigrationGeneratorSchema,
): Promise<GeneratorCallback | void> => {
  const name = kebabCase(options.name);
  // Shown by `nx migrate` when the migration runs, so it needs to say something
  const description =
    options.description ?? 'TODO: Add short description of the migration';
  const kind = options.kind ?? 'deterministic';

  const hasImplementation = kind === 'deterministic' || kind === 'hybrid';
  const hasPrompt = kind === 'agentic' || kind === 'hybrid';
  const isHybrid = kind === 'hybrid';

  const plugin = readProjectConfigurationUnqualified(tree, options.project);

  const tsConfigPath = joinPathFragments(plugin.root, 'tsconfig.json');
  if (!tree.exists(tsConfigPath)) {
    throw new Error(
      `Selected plugin project ${options.project} is not a TypeScript project`,
    );
  }

  const sourceRoot = plugin.sourceRoot ?? joinPathFragments(plugin.root, 'src');
  const srcDir = sourceRoot.split('/').filter(Boolean).pop();
  // Migrations are grouped by the release that ships them, so their order is
  // visible at a glance as the collection grows. A new migration lands in
  // `latest` — the release that picks it up moves it into its version folder.
  const migrationPath = `${srcDir}/migrations/latest/${name}`;
  const migrationDir = joinPathFragments(
    sourceRoot,
    'migrations',
    'latest',
    name,
  );

  const rootPackageJson = tree.exists('package.json')
    ? readJson(tree, 'package.json')
    : undefined;
  const isNxPluginForAws = rootPackageJson?.name === '@aws/nx-plugin-source';

  // Ensure the project is a migrations-capable Nx Plugin: create package.json
  // and wire the `nx-migrations` field if absent.
  const esm = isEsmWorkspace(tree);
  const pluginPackageJsonPath = joinPathFragments(plugin.root, 'package.json');
  if (!tree.exists(pluginPackageJsonPath)) {
    writeJson(tree, pluginPackageJsonPath, { name: plugin.name });
  }
  updateJson(tree, pluginPackageJsonPath, (pkg) => {
    // Match the plugin's module system to the workspace. Nx loads `.ts`
    // migrations via Node's native type stripping, ESM or CommonJS accordingly.
    pkg.type ??= esm ? 'module' : 'commonjs';
    pkg.main ??= esm ? './src/index.js' : './src/index';
    pkg['nx-migrations'] ??= { migrations: './migrations.json' };
    return pkg;
  });

  // Migrations live at <sourceRoot>/migrations/<version>/<name>, so within this
  // repo the shared utils are three levels up. Elsewhere they come from the SDK.
  const formatImportPath = isNxPluginForAws
    ? '../../../utils/format'
    : `${PackageJson.name}/sdk/utils/format`;
  const testImportPath = isNxPluginForAws
    ? '../../../utils/test'
    : `${PackageJson.name}/sdk/utils/test`;

  // Scaffold the migration files, then prune the ones this kind doesn't use.
  // A single template set covers all kinds; `isHybrid` toggles the parts that
  // deviate (the codemod's `agentContext`, the prompt's phrasing).
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    migrationDir,
    { name, description, isHybrid, formatImportPath, testImportPath },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  if (!hasImplementation) {
    tree.delete(joinPathFragments(migrationDir, 'migration.ts'));
    tree.delete(joinPathFragments(migrationDir, 'migration.spec.ts'));
  }
  if (!hasPrompt) {
    tree.delete(joinPathFragments(migrationDir, 'prompt.md'));
  }

  // Register the migration in migrations.json (no version of our own — the
  // plugin author stamps versions at release time, and an already-stamped one
  // is preserved). The fields present discriminate the kind for nx. Paths are
  // relative to the migrations.json directory (plugin root).
  const migrationsJsonPath = joinPathFragments(plugin.root, 'migrations.json');
  const migrationsJson = tree.exists(migrationsJsonPath)
    ? readJson(tree, migrationsJsonPath)
    : {
        $schema: 'http://json-schema.org/schema',
        name: readJson(tree, pluginPackageJsonPath).name ?? plugin.name,
        generators: {},
      };
  writeJson(tree, migrationsJsonPath, {
    ...migrationsJson,
    generators: sortObjectKeys({
      ...migrationsJson.generators,
      [name]: {
        ...(migrationsJson.generators?.[name]?.version
          ? { version: migrationsJson.generators[name].version }
          : {}),
        description,
        ...(hasImplementation
          ? { implementation: `./${migrationPath}/migration` }
          : {}),
        ...(hasPrompt ? { prompt: `./${migrationPath}/prompt.md` } : {}),
      },
    }),
  });

  // Deterministic and hybrid migrations import @nx/devkit and, outside this
  // repo, `formatFilesInSubtree` from the @aws/nx-plugin SDK. Both must resolve
  // for nx to run them (already present in ours).
  if (hasImplementation && !isNxPluginForAws) {
    const deps = {
      ...withVersions(['@nx/devkit']),
      [PackageJson.name]: `^${PackageJson.version}`,
    };
    addDependenciesToPackageJson(tree, {}, deps);
    addDependenciesToPackageJson(tree, deps, {}, pluginPackageJsonPath);
  }

  await addGeneratorMetricsIfApplicable(tree, [NX_MIGRATION_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  if (hasImplementation && !isNxPluginForAws) {
    return () =>
      installDependencies(tree, options.preferInstallDependencies, {
        languages: ['typescript'],
        ensureResolvable: ['@nx/devkit'],
      });
  }
};

export default tsNxMigrationGenerator;
