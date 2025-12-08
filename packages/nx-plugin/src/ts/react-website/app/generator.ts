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
import { TsReactWebsiteGeneratorSchema } from './schema';
import { applicationGenerator } from '@nx/react';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { getNpmScopePrefix, toScopeAlias } from '../../../utils/npm-scope';
import { configureTsProject } from '../../lib/ts-project-utils';
import { ITsDepVersion, withVersions } from '../../../utils/versions';
import { getRelativePathToRoot } from '../../../utils/paths';
import { kebabCase, toClassName, toKebabCase } from '../../../utils/names';
import {
  addDestructuredImport,
  replaceIfExists,
  addSingleImport,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { relative } from 'path';
import { sortObjectKeys } from '../../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { addWebsiteInfra } from '../../../utils/website-constructs/website-constructs';
import { resolveIacProvider } from '../../../utils/iac';

export const SUPPORTED_UX_PROVIDERS = ['None', 'Cloudscape'] as const;

export type UxProvider = (typeof SUPPORTED_UX_PROVIDERS)[number];

export const REACT_WEBSITE_APP_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsReactWebsiteGenerator(
  tree: Tree,
  schema: TsReactWebsiteGeneratorSchema,
) {
  const enableTailwind = schema.enableTailwind ?? true;
  const enableTanstackRouter = schema.enableTanstackRouter ?? true;
  const uxProvider: UxProvider = schema.uxProvider ?? 'Cloudscape';
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

  // Configure load:runtime-config target based on IaC provider
  const iacProvider = await resolveIacProvider(tree, schema.iacProvider);

  if (iacProvider === 'CDK') {
    targets['load:runtime-config'] = {
      executor: 'nx:run-commands',
      metadata: {
        description: `Load runtime config from your deployed stack for dev purposes. You must set your AWS CLI credentials whilst calling 'pnpm exec nx run ${fullyQualifiedName}:load:runtime-config'`,
      },
      options: {
        command: `aws s3 cp s3://\`aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName, '${kebabCase(npmScopePrefix)}-')][].Outputs[] | [?contains(OutputKey, '${websiteNameClassName}WebsiteBucketName')].OutputValue" --output text\`/runtime-config.json './${websiteContentPath}/public/runtime-config.json'`,
      },
    };
  } else if (iacProvider === 'Terraform') {
    targets['load:runtime-config'] = {
      executor: 'nx:run-commands',
      metadata: {
        description:
          "Load runtime config from most recently applied terraform env for dev purposes. Copies the runtime config from the Terraform dist directory to the website's public directory.",
      },
      options: {
        command:
          'node -e "const fs=require(\'fs\');fs.mkdirSync(process.env.DEST_DIR,{recursive:true});fs.copyFileSync(process.env.SRC_FILE,process.env.DEST_FILE);"',
        env: {
          SRC_FILE: 'dist/packages/common/terraform/runtime-config.json',
          DEST_DIR: `{projectRoot}/public`,
          DEST_FILE: `{projectRoot}/public/runtime-config.json`,
        },
      },
    };
  } else {
    throw new Error(
      `Unknown iacProvider: ${iacProvider}. Supported providers are: CDK, Terraform`,
    );
  }

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

  // Add a serve-local target for running the website and its dependencies locally
  targets['serve-local'] = {
    executor: '@nx/vite:dev-server',
    options: {
      buildTarget: `${fullyQualifiedName}:build:development`,
      hmr: true,
      mode: 'serve-local',
    },
    continuous: true,
  };

  projectConfiguration.targets = sortObjectKeys(targets);

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfiguration);
  addGeneratorMetadata(
    tree,
    projectConfiguration.name,
    REACT_WEBSITE_APP_GENERATOR_INFO,
    {
      uxProvider,
    },
  );

  configureTsProject(tree, {
    dir: websiteContentPath,
    fullyQualifiedName,
  });

  await sharedConstructsGenerator(tree, {
    iacProvider,
  });

  addWebsiteInfra(tree, {
    iacProvider,
    websiteProjectName: fullyQualifiedName,
    scopeAlias: toScopeAlias(npmScopePrefix),
    websiteContentPath: joinPathFragments('dist', websiteContentPath),
    websiteNameKebabCase,
    websiteNameClassName,
  });

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const libraryRoot = projectConfig.root;
  tree.delete(joinPathFragments(libraryRoot, 'src', 'app'));
  const appCommonTemplatePath = joinPathFragments(
    __dirname,
    './files/app/common',
  );
  const appTemplatePath = joinPathFragments(
    __dirname,
    `./files/app/${uxProvider.toLowerCase()}`,
  );

  generateFiles(
    tree, // the virtual file system
    appCommonTemplatePath, // path to the file templates
    libraryRoot, // destination path of the files
    {
      ...schema,
      fullyQualifiedName,
      pkgMgrCmd: getPackageManagerCommand().exec,
      enableTailwind,
      enableTanstackRouter,
    }, // config object to replace variable in file templates
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  generateFiles(
    tree, // the virtual file system
    appTemplatePath, // path to the file templates
    libraryRoot, // destination path of the files
    {
      ...schema,
      fullyQualifiedName,
      pkgMgrCmd: getPackageManagerCommand().exec,
      enableTailwind,
      enableTanstackRouter,
    }, // config object to replace variable in file templates
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  if (enableTanstackRouter) {
    const routerCommonTemplatePath = joinPathFragments(
      __dirname,
      './files/tanstack-router/common',
    );
    const routerTemplatePath = joinPathFragments(
      __dirname,
      `./files/tanstack-router/${uxProvider.toLowerCase()}`,
    );

    generateFiles(
      tree,
      routerCommonTemplatePath,
      libraryRoot,
      {
        ...schema,
        fullyQualifiedName,
        pkgMgrCmd: getPackageManagerCommand().exec,
        enableTailwind,
        enableTanstackRouter,
      },
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );

    generateFiles(
      tree,
      routerTemplatePath,
      libraryRoot,
      {
        ...schema,
        fullyQualifiedName,
        pkgMgrCmd: getPackageManagerCommand().exec,
        enableTailwind,
        enableTanstackRouter,
      }, // config object to replace variable in file templates
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );
    tree.delete(joinPathFragments(websiteContentPath, 'src', 'app.tsx'));
  }

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
  const viteConfigPath = joinPathFragments(libraryRoot, 'vite.config.mts');

  if (tree.exists(viteConfigPath)) {
    // Add Tanstack Router import if enabled
    if (enableTanstackRouter) {
      addDestructuredImport(
        tree,
        viteConfigPath,
        ['tanstackRouter'],
        '@tanstack/router-plugin/vite',
      );

      addDestructuredImport(tree, viteConfigPath, ['resolve'], 'path');
    }

    addSingleImport(
      tree,
      viteConfigPath,
      'tsconfigPaths',
      'vite-tsconfig-paths',
    );

    // Add TailwindCSS import if enabled
    if (enableTailwind) {
      addSingleImport(tree, viteConfigPath, 'tailwindcss', '@tailwindcss/vite');
    }

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
            const pluginsArray = [...pluginsConfig.elements];

            if (enableTanstackRouter) {
              pluginsArray.unshift(
                factory.createCallExpression(
                  factory.createIdentifier('tanstackRouter'),
                  undefined,
                  [
                    factory.createObjectLiteralExpression([
                      factory.createPropertyAssignment(
                        factory.createIdentifier('routesDirectory'),
                        factory.createCallExpression(
                          factory.createIdentifier('resolve'),
                          undefined,
                          [
                            factory.createIdentifier('__dirname'),
                            factory.createStringLiteral('src/routes'),
                          ],
                        ),
                      ),
                      factory.createPropertyAssignment(
                        factory.createIdentifier('generatedRouteTree'),
                        factory.createCallExpression(
                          factory.createIdentifier('resolve'),
                          undefined,
                          [
                            factory.createIdentifier('__dirname'),
                            factory.createStringLiteral('src/routeTree.gen.ts'),
                          ],
                        ),
                      ),
                    ]),
                  ],
                ),
              );
            }

            // Add TailwindCSS plugin if enabled
            if (enableTailwind) {
              pluginsArray.push(
                factory.createCallExpression(
                  factory.createIdentifier('tailwindcss'),
                  undefined,
                  [],
                ),
              );
            }

            pluginsArray.push(
              factory.createCallExpression(
                factory.createIdentifier('tsconfigPaths'),
                undefined,
                [],
              ),
            );

            return factory.createPropertyAssignment(
              'plugins',
              factory.createArrayLiteralExpression(pluginsArray, true),
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

  const devDependencies: ITsDepVersion[] = ['vite-tsconfig-paths', '@nx/react'];

  const dependencies: ITsDepVersion[] = ['react', 'react-dom'];

  if (uxProvider === 'Cloudscape') {
    dependencies.push(
      '@cloudscape-design/components',
      '@cloudscape-design/board-components',
      '@cloudscape-design/global-styles',
    );
  }

  // Add TailwindCSS dependencies if enabled
  if (enableTailwind) {
    dependencies.push('tailwindcss');
    devDependencies.push('@tailwindcss/vite');
  }
  if (enableTanstackRouter) {
    dependencies.push('@tanstack/react-router');
    devDependencies.push(
      '@tanstack/router-plugin',
      '@tanstack/router-generator',
      '@tanstack/virtual-file-routes',
      '@tanstack/router-utils',
    );
  }

  addDependenciesToPackageJson(
    tree,
    withVersions(dependencies),
    withVersions(devDependencies),
  );

  await addGeneratorMetricsIfApplicable(tree, [
    REACT_WEBSITE_APP_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    if (!schema.skipInstall) {
      installPackagesTask(tree);
    }
  };
}
export default tsReactWebsiteGenerator;
