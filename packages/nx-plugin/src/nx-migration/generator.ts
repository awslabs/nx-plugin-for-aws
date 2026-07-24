/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../utils/format';
import { kebabCase } from '../utils/names';
import { sortObjectKeys } from '../utils/object';
import type { NxMigrationGeneratorSchema } from './schema';

/**
 * Scaffolds a new migration under `src/migrations/<name>` and registers it in
 * the plugin's `migrations.json`. Internal to the @aws/nx-plugin repo.
 *
 * Supports all three Nx 23 migration kinds:
 * - `deterministic`: a codemod (`implementation`).
 * - `agentic`: a `prompt` markdown file applied by the user's agent.
 * - `hybrid`: both — the codemod does the mechanical part and returns
 *   `agentContext`, then the prompt hands off to the agent for the rest.
 *
 * No `version` is written — versions are stamped from git tags at package
 * time (see `scripts/stamp-migrations.ts`).
 */
export const nxMigrationGenerator = async (
  tree: Tree,
  options: NxMigrationGeneratorSchema,
): Promise<void> => {
  const name = kebabCase(options.name);
  const { description } = options;
  const kind = options.kind ?? 'deterministic';

  const hasImplementation = kind === 'deterministic' || kind === 'hybrid';
  const hasPrompt = kind === 'agentic' || kind === 'hybrid';

  const migrationDir = joinPathFragments(
    'packages',
    'nx-plugin',
    'src',
    'migrations',
    name,
  );

  // Scaffold the files for this kind, preserving anything already written
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', kind),
    migrationDir,
    { name, description },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Register the migration in migrations.json (no version — stamped at package
  // time from git tags). The fields present discriminate the kind for nx.
  const migrationsJsonPath = joinPathFragments(
    'packages',
    'nx-plugin',
    'migrations.json',
  );
  const migrationsJson = tree.exists(migrationsJsonPath)
    ? readJson(tree, migrationsJsonPath)
    : {
        $schema: 'http://json-schema.org/schema',
        name: '@aws/nx-plugin',
        generators: {},
      };
  writeJson(tree, migrationsJsonPath, {
    ...migrationsJson,
    generators: sortObjectKeys({
      ...migrationsJson.generators,
      [name]: {
        description,
        ...(hasImplementation
          ? { implementation: `./src/migrations/${name}/migration` }
          : {}),
        // Prompt paths must resolve within the migrations.json directory, so
        // they are relative to the migration's source folder.
        ...(hasPrompt ? { prompt: `./src/migrations/${name}/prompt.md` } : {}),
        ...migrationsJson.generators?.[name],
      },
    }),
  });

  await formatFilesInSubtree(tree);
};

export default nxMigrationGenerator;
