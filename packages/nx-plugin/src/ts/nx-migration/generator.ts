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
  writeJson,
} from '@nx/devkit';
import PackageJson from '../../../package.json' with { type: 'json' };
import { declareDependencies } from '../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../utils/format';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import {
  LATEST_MIGRATIONS_DIR,
  migrationKey,
} from '../../utils/migration-versions';
import { kebabCase } from '../../utils/names';
import {
  getGeneratorInfo,
  isNxPluginForAwsWorkspace,
  type NxGeneratorInfo,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import {
  addNxPluginDependencies,
  configureNxPluginPackageJson,
  NX_PLUGIN_DEPENDENCIES,
  readNxPluginProject,
} from '../nx-plugin/utils';
import type { TsNxMigrationGeneratorSchema } from './schema';

export const DEPENDENCIES = declareDependencies()({
  ts: [...NX_PLUGIN_DEPENDENCIES],
});

export const NX_MIGRATION_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Scaffolds a migration in an Nx Plugin project and registers it in the
 * plugin's `migrations.json` (creating the manifest and wiring the
 * `nx-migrations` field into the plugin's `package.json` if absent), so
 * `nx migrate` applies it when users upgrade the plugin.
 *
 * Supports all three migration kinds:
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

  const plugin = readNxPluginProject(tree, options.project);

  const sourceRoot = plugin.sourceRoot ?? joinPathFragments(plugin.root, 'src');
  const srcDir = sourceRoot.split('/').filter(Boolean).pop();
  // Migrations are grouped by the release that ships them. A new one lands in
  // `latest` — the release that picks it up moves it into its version folder.
  const migrationPath = `${srcDir}/migrations/${LATEST_MIGRATIONS_DIR}/${name}`;
  const migrationDir = joinPathFragments(
    sourceRoot,
    'migrations',
    LATEST_MIGRATIONS_DIR,
    name,
  );
  const key = migrationKey(LATEST_MIGRATIONS_DIR, name);

  const isNxPluginForAws = isNxPluginForAwsWorkspace(tree);

  // Point the plugin at its migrations manifest so `nx migrate` finds them
  const pluginPackageJsonPath = configureNxPluginPackageJson(
    tree,
    plugin,
    'nx-migrations',
    { migrations: './migrations.json' },
  );

  // Migrations sit three levels below the source root, so in this repo the
  // shared utils are relative. Elsewhere they come from the SDK.
  const formatImportPath = isNxPluginForAws
    ? '../../../utils/format'
    : `${PackageJson.name}/sdk/utils/format`;
  const testImportPath = isNxPluginForAws
    ? '../../../utils/test'
    : `${PackageJson.name}/sdk/utils/test`;

  // One template set covers all kinds — scaffold it, then prune what this kind
  // doesn't use.
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

  if (isNxPluginForAws) {
    // In the plugin's own repo migrations.json is assembled from these folders
    // at build time (see utils/migration-manifest.ts), so registration is just
    // the description beside the code — its kind comes from the files present.
    // Two migration PRs then touch disjoint files rather than one shared manifest.
    const metadataPath = joinPathFragments(migrationDir, 'metadata.json');
    if (!tree.exists(metadataPath)) {
      writeJson(tree, metadataPath, { description });
    }
  } else {
    // Elsewhere, register the migration under its folder-prefixed key. The fields
    // present discriminate the kind for nx, and paths are relative to
    // migrations.json. No version is written, but an already-stamped one is kept.
    const migrationsJsonPath = joinPathFragments(
      plugin.root,
      'migrations.json',
    );
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
        [key]: {
          ...(migrationsJson.generators?.[key]?.version
            ? { version: migrationsJson.generators[key].version }
            : {}),
          description,
          ...(hasImplementation
            ? { implementation: `./${migrationPath}/migration` }
            : {}),
          ...(hasPrompt ? { prompt: `./${migrationPath}/prompt.md` } : {}),
        },
      }),
    });
  }

  // Codemods import @nx/devkit and the @aws/nx-plugin SDK, both of which must
  // resolve for nx to run them
  if (hasImplementation) {
    addNxPluginDependencies(tree, pluginPackageJsonPath, DEPENDENCIES);
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
