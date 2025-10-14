/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  ProjectConfiguration,
  TargetConfiguration,
  Tree,
} from '@nx/devkit';
import { withVersions } from '../versions';
import { query, replace } from '../ast';
import {
  ArrayLiteralExpression,
  factory,
  ObjectLiteralExpression,
  PropertyAssignment,
  SyntaxKind,
} from 'typescript';
import { StringLiteral } from '@phenomnomnominal/tsquery';
import { getRelativePathToRoot } from '../paths';
import { addDependencyToTargetIfNotPresent } from '../nx';

export interface AddPythonBundleTargetOptions {
  /**
   * Python platform
   * @default x86_64-manylinux2014
   */
  pythonPlatform?: 'x86_64-manylinux2014' | 'aarch64-manylinux2014';
}

interface CreatePythonBundleTargetOptions
  extends Required<AddPythonBundleTargetOptions> {
  /**
   * Directory of the python project from the monorepo root
   */
  projectDir: string;

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
  projectDir,
  packageName,
  pythonPlatform,
  bundleTargetName,
}: CreatePythonBundleTargetOptions): TargetConfiguration => {
  return {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${projectDir}/${bundleTargetName}`],
    options: {
      commands: [
        `uv export --frozen --no-dev --no-editable --project ${projectDir} --package ${packageName} -o dist/${projectDir}/${bundleTargetName}/requirements.txt`,
        `uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform ${pythonPlatform} --target dist/${projectDir}/${bundleTargetName} -r dist/${projectDir}/${bundleTargetName}/requirements.txt`,
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

  const pythonPlatform = opts?.pythonPlatform ?? 'x86_64-manylinux2014';
  const bundleTargetName =
    pythonPlatform === 'aarch64-manylinux2014' ? 'bundle-arm' : 'bundle-x86';

  if (!project.targets?.[bundleTargetName]) {
    project.targets[bundleTargetName] = {
      ...createPythonBundleTarget({
        projectDir: project.root,
        packageName: project.name,
        pythonPlatform,
        bundleTargetName,
      }),
      dependsOn: ['compile'],
    };
  }

  // Add a "bundle" target which depends on either bundle-arm or bundle-x86 (or both)
  addDependencyToTargetIfNotPresent(project, 'bundle', bundleTargetName);
  addDependencyToTargetIfNotPresent(project, 'build', 'bundle');

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
export const addTypeScriptBundleTarget = (
  tree: Tree,
  project: ProjectConfiguration,
  opts: AddTypeScriptBundleTargetOptions,
) => {
  project.targets ??= {};

  // Check if AWS SDK is external
  const awsSdkRegex = /@aws-sdk\/.*/;
  const isAwsSdkExternal = opts.external?.some((ext) =>
    ext instanceof RegExp
      ? ext.source === awsSdkRegex.source
      : ext === awsSdkRegex.source,
  );

  // Generate empty rolldown config if it doesn't exist
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'ts'),
    project.root,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add the bundle target
  if (!project.targets.bundle) {
    project.targets.bundle = {
      cache: true,
      outputs: [`{workspaceRoot}/dist/{projectRoot}/bundle`],
      executor: 'nx:run-commands',
      options: {
        command: 'rolldown -c rolldown.config.ts',
        cwd: '{projectRoot}',
      },
      dependsOn: ['compile'],
    };
  }

  // Add bundle to the build target
  addDependencyToTargetIfNotPresent(project, 'build', 'bundle');

  const rolldownConfigPath = joinPathFragments(
    project.root,
    'rolldown.config.ts',
  );

  const rolldownConfigArraySelector =
    'CallExpression:has(Identifier[name="defineConfig"]) > ArrayLiteralExpression';

  // Add disableTreeShake function if AWS SDK is not external and it doesn't exist
  // This is due to an issue with rolldown bundling for the SDK, and can likely be removed when resolved
  // https://github.com/rolldown/rolldown/issues/6513
  if (!isAwsSdkExternal) {
    const disableTreeShakeSelector =
      'VariableDeclaration:has(Identifier[name="disableTreeShake"])';
    if (
      query(tree, rolldownConfigPath, disableTreeShakeSelector).length === 0
    ) {
      const content = tree.read(rolldownConfigPath, 'utf-8');
      const disableTreeShakeFunction = `// Disables tree-shaking for the given module patterns
const disableTreeShake = (patterns: RegExp[]) => ({
  name: 'disable-treeshake',
  transform: (code, id) => {
    if (patterns.some(p => p.test(id))) {
      return { code, map: null, moduleSideEffects: 'no-treeshake' };
    }
    return null;
  },
});

`;
      const defineConfigIndex = content.indexOf('export default defineConfig');
      if (defineConfigIndex !== -1) {
        const newContent =
          content.slice(0, defineConfigIndex) +
          disableTreeShakeFunction +
          content.slice(defineConfigIndex);
        tree.write(rolldownConfigPath, newContent);
      }
    }
  }

  // Check whether we already have a config entry with input set to targetFilePath
  if (
    query(
      tree,
      rolldownConfigPath,
      `${rolldownConfigArraySelector} PropertyAssignment:has(Identifier[name="input"]):has(StringLiteral[value="${opts.targetFilePath}"])`,
    ).length === 0
  ) {
    // We don't have one, so append it
    replace(
      tree,
      rolldownConfigPath,
      rolldownConfigArraySelector,
      (node: ArrayLiteralExpression) => {
        return factory.createArrayLiteralExpression([
          ...node.elements,
          factory.createObjectLiteralExpression(
            [
              factory.createPropertyAssignment(
                factory.createIdentifier('input'),
                factory.createStringLiteral(opts.targetFilePath, true),
              ),
              factory.createPropertyAssignment(
                factory.createIdentifier('output'),
                factory.createObjectLiteralExpression(
                  [
                    factory.createPropertyAssignment(
                      factory.createIdentifier('file'),
                      factory.createStringLiteral(
                        joinPathFragments(
                          getRelativePathToRoot(tree, project.name),
                          'dist',
                          project.root,
                          'bundle',
                          opts.bundleOutputDir ?? '.',
                          'index.js',
                        ),
                        true,
                      ),
                    ),
                    factory.createPropertyAssignment(
                      factory.createIdentifier('format'),
                      factory.createStringLiteral('cjs', true),
                    ),
                    factory.createPropertyAssignment(
                      factory.createIdentifier('inlineDynamicImports'),
                      factory.createTrue(),
                    ),
                  ],
                  true,
                ),
              ),
              factory.createPropertyAssignment(
                factory.createIdentifier('platform'),
                factory.createStringLiteral(opts.platform ?? 'node', true),
              ),
              ...(opts.external
                ? [
                    factory.createPropertyAssignment(
                      factory.createIdentifier('external'),
                      factory.createArrayLiteralExpression(
                        opts.external.map((ext) =>
                          typeof ext === 'string'
                            ? factory.createStringLiteral(ext, true)
                            : factory.createRegularExpressionLiteral(
                                `/${ext.source}/`,
                              ),
                        ),
                      ),
                    ),
                  ]
                : []),
              ...(!isAwsSdkExternal
                ? [
                    factory.createPropertyAssignment(
                      factory.createIdentifier('plugins'),
                      factory.createArrayLiteralExpression([
                        factory.createCallExpression(
                          factory.createIdentifier('disableTreeShake'),
                          undefined,
                          [
                            factory.createArrayLiteralExpression([
                              factory.createRegularExpressionLiteral(
                                `/${awsSdkRegex.source}/`,
                              ),
                            ]),
                          ],
                        ),
                      ]),
                    ),
                  ]
                : []),
            ],
            true,
          ),
        ]);
      },
    );
  }

  addDependenciesToPackageJson(tree, {}, withVersions(['rolldown']));
};
