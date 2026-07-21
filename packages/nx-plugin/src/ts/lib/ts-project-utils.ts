/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, logger, type Tree, updateJson } from '@nx/devkit';
import { join, relative } from 'path';
import { addLicenseCheckToLintTarget } from '../../license/config';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../../utils/config/utils';
import { isEsmWorkspace } from '../../utils/module-format';
import { ensureProjectPackageJson } from '../../utils/project-package-json';
import { configureBiomeLint } from './biome';
import type { ConfigureProjectOptions } from './types';
import { configureVitest } from './vitest';

interface TsConfigReference {
  path: string;
}

/**
 * Merges new TypeScript project references into existing ones, deduplicating by
 * path and preserving the order of existing references so re-running a
 * generator neither duplicates nor reorders references.
 */
export const mergeTsReferences = (
  existing: TsConfigReference[] | undefined,
  toAdd: TsConfigReference[],
): TsConfigReference[] => {
  const references = [...(existing ?? [])];
  const existingPaths = new Set(references.map((ref) => ref.path));
  for (const ref of toAdd) {
    if (!existingPaths.has(ref.path)) {
      references.push(ref);
      existingPaths.add(ref.path);
    }
  }
  return references;
};

/**
 * Updates typescript projects
 */
export const configureTsProject = async (
  tree: Tree,
  options: ConfigureProjectOptions,
) => {
  // Without workspace initialisation there's no biome config (lint/format
  // become no-ops) and no ts#sync registration (cross-project imports won't
  // be declared as workspace dependencies) — point the user at init rather
  // than leaving them to discover the gaps one failure at a time. Either
  // init artefact counts as initialised (tests seed biome.json directly).
  if (
    !tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME) &&
    !tree.exists('biome.json')
  ) {
    logger.warn(
      `This workspace has no ${AWS_NX_PLUGIN_CONFIG_FILE_NAME} — run 'nx g @aws/nx-plugin:init' (or 'nx add @aws/nx-plugin') to configure linting, formatting and workspace dependency sync.`,
    );
  }

  // When the caller doesn't specify a module format, infer it from the
  // workspace root package.json (defaulting to ESM for a fresh workspace).
  const esm = options.esm ?? isEsmWorkspace(tree);

  // Remove a conflicting `module: commonjs` from the project tsconfig.json
  // (CommonJS is configured on tsconfig.lib.json below when needed).
  updateJson(tree, join(options.dir, 'tsconfig.json'), (tsConfig) => ({
    ...tsConfig,
    compilerOptions: {
      ...tsConfig.compilerOptions,
      module:
        tsConfig.compilerOptions?.module === 'commonjs'
          ? undefined
          : tsConfig.compilerOptions?.module,
    },
  }));
  const outDirToRootRelativePath = relative(
    join(tree.root, options.dir),
    tree.root,
  );
  const distDir = join(outDirToRootRelativePath, 'dist', options.dir, 'tsc');
  // Remove baseUrl and rootDir from the tsconfig.lib.json
  if (tree.exists(join(options.dir, 'tsconfig.lib.json'))) {
    updateJson(tree, join(options.dir, 'tsconfig.lib.json'), (tsConfig) => ({
      ...tsConfig,
      compilerOptions: {
        ...tsConfig.compilerOptions,
        baseUrl: undefined,
        rootDir: '.',
        outDir: distDir,
        tsBuildInfoFile: join(distDir, 'tsconfig.lib.tsbuildinfo'),
        // @nx/js configures the lib for ESM (module `nodenext`). CommonJS
        // projects use `node16`, which honours the workspace's
        // `type: commonjs`, emits CommonJS and resolves extensionless relative
        // imports. (Plain `commonjs`/`node` is deprecated in TypeScript 6.)
        ...(esm ? {} : { module: 'node16', moduleResolution: 'node16' }),
      },
    }));
  }
  // Update root project tsconfig
  updateJson(tree, 'tsconfig.base.json', (tsConfig) => ({
    ...tsConfig,
    compilerOptions: {
      ...tsConfig.compilerOptions,
      // baseUrl is deprecated in TypeScript 6 — use ./ prefix in paths instead
      baseUrl: undefined,
      rootDir: '.',
      paths: {
        // Remove any legacy colon-form alias for this project (eg :foo/bar)
        ...Object.fromEntries(
          Object.entries(tsConfig.compilerOptions?.paths ?? {}).filter(
            ([k]) => k !== `:${options.fullyQualifiedName.slice(1)}`,
          ),
        ),
        [options.fullyQualifiedName]: [
          `./${joinPathFragments(options.dir, 'src', 'index.ts')}`,
        ],
      },
    },
  }));
  if (tree.exists('tsconfig.json')) {
    updateJson(tree, 'tsconfig.json', (tsConfig) => ({
      ...tsConfig,
      // Add project references, deduplicating and preserving existing order
      references: mergeTsReferences(tsConfig.references, [
        { path: `./${options.dir}` },
      ]),
    }));
  }
  // Every project carries a minimal private package.json so the workspace
  // follows the standard npm package layout (see ensureProjectPackageJson).
  ensureProjectPackageJson(tree, {
    dir: options.dir,
    fullyQualifiedName: options.fullyQualifiedName,
    esm,
  });

  await configureBiomeLint(tree, options);
  await configureVitest(tree, options);

  // If license checking is configured, make this project's lint target depend
  // on the root license-check target. No-op if there's no license-check target
  // (i.e. the license generator hasn't run); the license generator wires up
  // existing projects itself, so this works regardless of generator order.
  addLicenseCheckToLintTarget(tree, options.fullyQualifiedName);
};
