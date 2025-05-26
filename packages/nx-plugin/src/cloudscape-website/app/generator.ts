/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  Tree,
  readProjectConfiguration,
  joinPathFragments,
  generateFiles,
  names,
  updateJson,
  ProjectConfiguration,
  installPackagesTask,
  OverwriteStrategy,
  getPackageManagerCommand,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  factory,
  ObjectLiteralExpression,
  isPropertyAssignment,
  ArrayLiteralExpression,
} from 'typescript';
import { TsCloudScapeWebsiteGeneratorSchema } from './schema';
import { applicationGenerator } from '@nx/react';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { configureTsProject } from '../../ts/lib/ts-project-utils';
import { withVersions } from '../../utils/versions';
import { getRelativePathToRoot } from '../../utils/paths';
import { toClassName, toKebabCase } from '../../utils/names';
import {
  addStarExport,
  addDestructuredImport,
  replaceIfExists,
  addSingleImport,
} from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { relative } from 'path';
import kebabCase from 'lodash.kebabcase';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';

export const CLOUDSCAPE_WEBSITE_APP_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsCloudScapeWebsiteGenerator(
  tree: Tree,
  schema: TsCloudScapeWebsiteGeneratorSchema,
) {
  const npmScopePrefix = getNpmScopePrefix(tree);
  const websiteNameClassName = toClassName(schema.name);
  const websiteNameKebabCase = toKebabCase(schema.name);
  const fullyQualifiedName = `${npmScopePrefix}${websiteNameKebabCase}`;
  const websiteContentPath = joinPathFragments(
    schema.directory ?? '.',
    websiteNameKebabCase,
  );
  // TODO: consider exposing and supporting e2e tests
  const e2eTestRunner = 'none';
  await applicationGenerator(tree, {
    ...schema,
    name: fullyQualifiedName,
    directory: websiteContentPath,
    routing: false,
    e2eTestRunner,
    linter: 'eslint',
    bundler: 'vite',
    unitTestRunner: 'vitest',
    useProjectJson: true,
    style: 'css',
  });

  // Replace with simpler sample source code
  tree.delete(joinPathFragments(websiteContentPath, 'src'));

  const projectConfiguration = readProjectConfiguration(
    tree,
    fullyQualifiedName,
  );
  const targets = projectConfiguration.targets;
  targets['load:runtime-config'] = {
    executor: 'nx:run-commands',
    metadata: {
      description: `Load runtime config from your deployed stack for dev purposes. You must set your AWS CLI credentials whilst calling 'pnpm exec nx run ${fullyQualifiedName}:load:runtime-config'`,
    },
    options: {
      command: `aws s3 cp s3://\`aws cloudformation describe-stacks --query "Stacks[?StackName=='${kebabCase(npmScopePrefix)}-infra-sandbox'][].Outputs[?contains(OutputKey, 'WebsiteBucketName')].OutputValue" --output text\`/runtime-config.json './${websiteContentPath}/public/runtime-config.json'`,
    },
  };
  const buildTarget = targets['build'];
  targets['compile'] = {
    executor: 'nx:run-commands',
    outputs: ['{workspaceRoot}/dist/{projectRoot}/tsc'],
    options: {
      command: 'tsc --build tsconfig.app.json',
      cwd: '{projectRoot}',
    },
  };
  targets['bundle'] = {
    ...buildTarget,
    options: {
      ...buildTarget.options,
      outputPath: joinPathFragments('dist', websiteContentPath, 'bundle'),
    },
  };
  targets['build'] = {
    dependsOn: [
      'lint',
      'compile',
      'bundle',
      'test',
      ...(buildTarget.dependsOn ?? []),
    ],
    options: {
      outputPath: joinPathFragments('dist', websiteContentPath, 'bundle'),
    },
  };
  projectConfiguration.targets = sortObjectKeys(targets);

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);
  addGeneratorMetadata(
    tree,
    projectConfiguration.name,
    CLOUDSCAPE_WEBSITE_APP_GENERATOR_INFO,
  );

  configureTsProject(tree, {
    dir: websiteContentPath,
    fullyQualifiedName,
  });
  await sharedConstructsGenerator(tree);
  if (
    !tree.exists(
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'static-websites',
        `${websiteNameKebabCase}.ts`,
      ),
    )
  ) {
    const npmScopePrefix = getNpmScopePrefix(tree);
    generateFiles(
      tree,
      joinPathFragments(
        __dirname,
        'files',
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
      ),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app'),
      {
        ...schema,
        npmScopePrefix,
        scopeAlias: toScopeAlias(npmScopePrefix),
        websiteContentPath: joinPathFragments('dist', websiteContentPath),
        websiteNameKebabCase,
        websiteNameClassName,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    const shouldGenerateCoreStaticWebsiteConstruct = !tree.exists(
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'static-website.ts',
      ),
    );
    if (shouldGenerateCoreStaticWebsiteConstruct) {
      generateFiles(
        tree,
        joinPathFragments(
          __dirname,
          'files',
          SHARED_CONSTRUCTS_DIR,
          'src',
          'core',
        ),
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
        {
          ...schema,
          npmScopePrefix,
          scopeAlias: toScopeAlias(npmScopePrefix),
          websiteContentPath: joinPathFragments('dist', websiteContentPath),
          websiteNameKebabCase,
          websiteNameClassName,
        },
        {
          overwriteStrategy: OverwriteStrategy.KeepExisting,
        },
      );
    }
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'index.ts',
      ),
      './static-websites/index.js',
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'static-websites',
        'index.ts',
      ),
      `./${websiteNameKebabCase}.js`,
    );
    if (shouldGenerateCoreStaticWebsiteConstruct) {
      addStarExport(
        tree,
        joinPathFragments(
          PACKAGES_DIR,
          SHARED_CONSTRUCTS_DIR,
          'src',
          'core',
          'index.ts',
        ),
        './static-website.js',
      );
    }
  }
  updateJson(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
    (config: ProjectConfiguration) => {
      if (!config.targets) {
        config.targets = {};
      }
      if (!config.targets.build) {
        config.targets.build = {};
      }
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []),
        `${fullyQualifiedName}:build`,
      ];
      return config;
    },
  );
  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const libraryRoot = projectConfig.root;
  tree.delete(joinPathFragments(libraryRoot, 'src', 'app'));
  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, './files/app'), // path to the file templates
    libraryRoot, // destination path of the files
    {
      ...schema,
      fullyQualifiedName,
      pkgMgrCmd: getPackageManagerCommand().exec,
    }, // config object to replace variable in file templates
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );
  if (e2eTestRunner !== 'none') {
    const e2eFullyQualifiedName = `${fullyQualifiedName}-e2e`;
    const e2eRoot = readProjectConfiguration(tree, e2eFullyQualifiedName).root;
    generateFiles(
      tree, // the virtual file system
      joinPathFragments(__dirname, `./files/e2e/${e2eTestRunner}`), // path to the file templates
      e2eRoot, // destination path of the files
      { ...schema, ...names(fullyQualifiedName) },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    configureTsProject(tree, {
      fullyQualifiedName: e2eFullyQualifiedName,
      dir: e2eRoot,
    });
  }
  const viteConfigPath = joinPathFragments(libraryRoot, 'vite.config.ts');

  if (tree.exists(viteConfigPath)) {
    addDestructuredImport(
      tree,
      viteConfigPath,
      ['TanStackRouterVite'],
      '@tanstack/router-plugin/vite',
    );

    addSingleImport(
      tree,
      viteConfigPath,
      'tsconfigPaths',
      'vite-tsconfig-paths',
    );

    replaceIfExists(
      tree,
      viteConfigPath,
      'ObjectLiteralExpression',
      (node: ObjectLiteralExpression) => {
        const updatedProperties = node.properties.map((prop) => {
          if (isPropertyAssignment(prop) && prop.name.getText() === 'build') {
            const buildConfig = prop.initializer as ObjectLiteralExpression;
            return factory.createPropertyAssignment(
              'build',
              factory.createObjectLiteralExpression(
                buildConfig.properties.map((buildProp) => {
                  if (
                    isPropertyAssignment(buildProp) &&
                    buildProp.name.getText() === 'outDir'
                  ) {
                    return factory.createPropertyAssignment(
                      'outDir',
                      factory.createStringLiteral(
                        joinPathFragments(
                          getRelativePathToRoot(tree, fullyQualifiedName),
                          'dist',
                          websiteContentPath,
                        ),
                      ),
                    );
                  }
                  return buildProp;
                }),
                true,
              ),
            );
          } else if (
            isPropertyAssignment(prop) &&
            prop.name.getText() === 'plugins'
          ) {
            const pluginsConfig = prop.initializer as ArrayLiteralExpression;
            return factory.createPropertyAssignment(
              'plugins',
              factory.createArrayLiteralExpression(
                [
                  ...pluginsConfig.elements,
                  factory.createCallExpression(
                    factory.createIdentifier('TanStackRouterVite'),
                    undefined,
                    [],
                  ),
                  factory.createCallExpression(
                    factory.createIdentifier('tsconfigPaths'),
                    undefined,
                    [],
                  ),
                ],
                true,
              ),
            );
          }
          return prop;
        });
        return factory.createObjectLiteralExpression(updatedProperties, true);
      },
    );

    replaceIfExists(
      tree,
      viteConfigPath,
      'ObjectLiteralExpression',
      (node: ObjectLiteralExpression) => {
        return factory.createObjectLiteralExpression(
          [
            factory.createPropertyAssignment(
              'define',
              factory.createObjectLiteralExpression(
                [
                  factory.createPropertyAssignment(
                    'global',
                    factory.createObjectLiteralExpression(),
                  ),
                ],
                true,
              ),
            ),
            ...node.properties,
          ],
          true,
        );
      },
    );
  }

  updateJson(
    tree,
    joinPathFragments(websiteContentPath, 'tsconfig.json'),
    (tsconfig) => ({
      ...tsconfig,
      compilerOptions: {
        ...tsconfig.compilerOptions,
        moduleResolution: 'Bundler',
        module: 'Preserve',
      },
    }),
  );
  const outDirToRootRelativePath = relative(
    joinPathFragments(tree.root, websiteContentPath),
    tree.root,
  );
  const distDir = joinPathFragments(
    outDirToRootRelativePath,
    'dist',
    websiteContentPath,
    'tsc',
  );
  updateJson(
    tree,
    joinPathFragments(websiteContentPath, 'tsconfig.app.json'),
    (tsconfig) => ({
      ...tsconfig,
      compilerOptions: {
        ...tsconfig.compilerOptions,
        outDir: distDir,
        tsBuildInfoFile: joinPathFragments(distDir, 'tsconfig.lib.tsbuildinfo'),
        lib: ['DOM'],
      },
    }),
  );
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@cloudscape-design/components',
      '@cloudscape-design/board-components',
      '@cloudscape-design/global-styles',
      '@tanstack/react-router',
    ]),
    withVersions(['@tanstack/router-plugin', 'vite-tsconfig-paths']),
  );

  await addGeneratorMetricsIfApplicable(tree, [
    CLOUDSCAPE_WEBSITE_APP_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    if (!schema.skipInstall) {
      installPackagesTask(tree);
    }
  };
}
export default tsCloudScapeWebsiteGenerator;
