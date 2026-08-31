/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
} from '@nx/devkit';
import { applyGritQL } from '../ast.js';
import {
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../declared-dependencies.js';
import { addDependenciesToPackageJson } from '../dependencies.js';
import {
  addArtifactDependencyToTargets,
  addDependencyToTargetIfNotPresent,
  normalizeTargetKeyOrder,
} from '../nx.js';
import { getRelativePathToRoot } from '../paths.js';
import {
  type ITsDepVersion,
  LAMBDA_RUNTIME_VERSIONS,
  withVersions,
} from '../versions.js';

/** Dependencies a caller must declare to add a TypeScript bundle target. */
export const BUNDLE_DEPENDENCIES = [
  { name: 'rolldown' },
] as const satisfies readonly { name: ITsDepVersion }[];

export interface AddPythonBundleTargetOptions {
  /**
   * Python platform
   * @default x86_64-manylinux_2_28
   */
  pythonPlatform?: 'x86_64-manylinux_2_28' | 'aarch64-manylinux_2_28';
}

interface CreatePythonBundleTargetOptions
  extends Required<AddPythonBundleTargetOptions> {
  /**
   * Python package name
   */
  packageName: string;

  /**
   * Name of the bundle target, used for the outdir for the bundle
   */
  bundleTargetName: string;
}

/**
 * Create a target for bundling a python project
 */
const createPythonBundleTarget = ({
  packageName,
  pythonPlatform,
  bundleTargetName,
}: CreatePythonBundleTargetOptions): TargetConfiguration => {
  return {
    cache: true,
    // The bundle holds exported dependencies and the entrypoint script, never
    // test files, so tests are excluded via `production`.
    inputs: ['production', '^production'],
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/{projectRoot}/${bundleTargetName}`],
    options: {
      commands: [
        `uv export --frozen --no-dev --no-editable --project {projectRoot} --package ${packageName} -o dist/{projectRoot}/${bundleTargetName}/requirements.txt`,
        // `--python-version` pins wheel resolution to the Lambda Python runtime,
        // so the bundle cannot be built against whichever interpreter happens to
        // be on the build machine.
        `uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform ${pythonPlatform} --python-version ${LAMBDA_RUNTIME_VERSIONS.python} --target dist/{projectRoot}/${bundleTargetName} -r dist/{projectRoot}/${bundleTargetName}/requirements.txt`,
      ],
      parallel: false,
    },
  };
};

/**
 * Adds a bundle target to the given project if it does not exist, and updates the build target to depend on it
 */
export const addPythonBundleTarget = (
  project: ProjectConfiguration,
  opts?: AddPythonBundleTargetOptions,
) => {
  if (!project.targets) {
    project.targets = {};
  }

  const pythonPlatform = opts?.pythonPlatform ?? 'x86_64-manylinux_2_28';
  const bundleTargetName =
    pythonPlatform === 'aarch64-manylinux_2_28' ? 'bundle-arm' : 'bundle-x86';

  if (!project.targets?.[bundleTargetName]) {
    project.targets[bundleTargetName] = normalizeTargetKeyOrder({
      ...createPythonBundleTarget({
        packageName: project.name,
        pythonPlatform,
        bundleTargetName,
      }),
      dependsOn: ['compile'],
    });
  }

  // Add a "bundle" target which depends on either bundle-arm or bundle-x86 (or both)
  addDependencyToTargetIfNotPresent(project, 'bundle', bundleTargetName);
  addArtifactDependencyToTargets(project, 'bundle');

  return {
    bundleTargetName,
    bundleOutputDir: joinPathFragments('dist', project.root, bundleTargetName),
  };
};

export interface AddTypeScriptBundleTargetOptions {
  /**
   * Path to the target file relative to the project dir
   */
  targetFilePath: string;

  /**
   * Sub directory to write bundled index.js file to (if any)
   * Outputs to dist/{projectRoot}/bundle/{bundleOutputDir}/index.js
   */
  bundleOutputDir?: string;

  /**
   * Modules to omit from the bundle and treat as external
   */
  external?: (string | RegExp)[];

  /**
   * Target platform for the bundle
   * @default 'node'
   */
  platform?: 'node' | 'browser' | 'neutral';
}

/**
 * Add a TypeScript bundle target using rolldown
 */
export const addTypeScriptBundleTarget = async <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  project: ProjectConfiguration,
  opts: AddTypeScriptBundleTargetOptions,
  declaration: D & MustDeclare<typeof BUNDLE_DEPENDENCIES, D>,
) => {
  project.targets ??= {};

  // Generate empty rolldown config if it doesn't exist
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'ts'),
    project.root,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add the bundle target
  if (!project.targets.bundle) {
    project.targets.bundle = normalizeTargetKeyOrder({
      cache: true,
      outputs: [`{workspaceRoot}/dist/{projectRoot}/bundle`],
      executor: 'nx:run-commands',
      options: {
        command: 'rolldown -c rolldown.config.ts',
        cwd: '{projectRoot}',
      },
      dependsOn: ['compile'],
    });
  }

  // Add bundle to the build target
  addArtifactDependencyToTargets(project, 'bundle');

  const rolldownConfigPath = joinPathFragments(
    project.root,
    'rolldown.config.ts',
  );

  const outputFile = joinPathFragments(
    getRelativePathToRoot(tree, project.name),
    'dist',
    project.root,
    'bundle',
    opts.bundleOutputDir ?? '.',
    'index.js',
  );

  const external = opts.external?.length
    ? opts.external
        .map((ext) =>
          typeof ext === 'string' ? `'${ext}'` : `/${ext.source}/`,
        )
        .join(', ')
    : '';

  const entry = `{
    tsconfig: 'tsconfig.lib.json',
    input: '${opts.targetFilePath}',
    output: { file: '${outputFile}', format: 'cjs', codeSplitting: false },
    platform: '${opts.platform ?? 'node'}',
    ${external ? `external: [${external}],` : ''}
  }`;

  // Use GritQL to append the config entry to the defineConfig array.
  // First try the non-empty array case using the accumulate (+=) operator,
  // with an idempotency guard that checks the input path is not already present.
  const appended = await applyGritQL(
    tree,
    rolldownConfigPath,
    `\`defineConfig([$items])\` where { $items <: not contains \`'${opts.targetFilePath}'\`, $items += ", ${entry}" }`,
  );

  if (!appended) {
    // Empty array — GritQL's += cannot accumulate into an empty list, so we
    // first insert a placeholder to make the array non-empty, then replace
    // the placeholder with the real entry via += (which handles regex
    // literals that are invalid inside GritQL backtick snippets).
    const inserted = await applyGritQL(
      tree,
      rolldownConfigPath,
      `\`defineConfig([])\` => \`defineConfig([__PLACEHOLDER__])\``,
    );
    if (inserted) {
      await applyGritQL(
        tree,
        rolldownConfigPath,
        `\`defineConfig([$items])\` where { $items <: \`__PLACEHOLDER__\` => ., $items += "${entry}" }`,
      );
    }
  }

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(forDependencies<typeof BUNDLE_DEPENDENCIES>(declaration), [
      'rolldown',
    ]),
  );
};
