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
  addProjectConfiguration,
} from '@nx/devkit';
import { tsquery, ast } from '@phenomnomnominal/tsquery';
import {
  factory,
  ObjectLiteralExpression,
  SourceFile,
  isPropertyAssignment,
} from 'typescript';
import { AppGeneratorSchema } from './schema';
import { applicationGenerator } from '@nx/react';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import kebabCase from 'lodash.kebabcase';
import { configureTsProject } from '../../ts/lib/ts-project-utils';
import { withVersions } from '../../utils/versions';
import { getRelativePathToRoot } from '../../utils/paths';
import { formatFilesInSubtree } from '../../utils/format';

export async function appGenerator(tree: Tree, schema: AppGeneratorSchema) {
  const npmScopePrefix = getNpmScopePrefix(tree);
  const fullyQualifiedName = `${npmScopePrefix}${schema.name}`;
  const websiteContentPath = joinPathFragments(
    schema.directory ?? '.',
    schema.name
  );

  // TODO: consider exposing and supporting e2e tests
  const e2eTestRunner = 'none';

  await applicationGenerator(tree, {
    ...schema,
    name: fullyQualifiedName,
    directory: websiteContentPath,
    routing: false,
    addPlugin: true,
    e2eTestRunner,
  });

  if (!tree.exists(`${websiteContentPath}/project.json`)) {
    addProjectConfiguration(tree, fullyQualifiedName, {
      root: websiteContentPath,
      name: fullyQualifiedName,
      sourceRoot: `${websiteContentPath}/src`,
      projectType: 'application',
      tags: [],
      targets: {},
    });
  }

  configureTsProject(tree, {
    dir: websiteContentPath,
    fullyQualifiedName,
  });

  await sharedConstructsGenerator(tree);

  const websiteNameKebabCase = kebabCase(schema.name);
  const constructsPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    websiteNameKebabCase,
    'index.ts'
  );

  if (!tree.exists(constructsPath)) {
    const npmScopePrefix = getNpmScopePrefix(tree);
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
      {
        ...schema,
        npmScopePrefix,
        scopeAlias: toScopeAlias(npmScopePrefix),
        websiteContentPath: joinPathFragments('dist', websiteContentPath),
        websiteNameKebabCase,
      }
    );

    addDependenciesToPackageJson(
      tree,
      withVersions(['constructs', '@aws/pdk', 'cdk-nag', 'aws-cdk-lib']),
      withVersions(['@aws-sdk/client-wafv2'])
    );

    const sharedConstructsIndexTsPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'index.ts'
    );
    const sharedConstructsIndexContents = tree
      .read(sharedConstructsIndexTsPath)
      .toString();

    const staticWebsiteExportDeclaration = factory.createExportDeclaration(
      undefined,
      undefined,
      undefined,
      factory.createStringLiteral(`./${websiteNameKebabCase}/index.js`)
    );

    const updatedIndex = tsquery
      .map(
        ast(sharedConstructsIndexContents),
        'SourceFile',
        (node: SourceFile) => {
          return {
            ...node,
            statements: [staticWebsiteExportDeclaration, ...node.statements],
          };
        }
      )
      .getFullText();

    if (sharedConstructsIndexContents !== updatedIndex) {
      tree.write(sharedConstructsIndexTsPath, updatedIndex);
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
    }
  );

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const libraryRoot = projectConfig.root;

  tree.delete(joinPathFragments(libraryRoot, 'src/app'));

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, './files/app'), // path to the file templates
    libraryRoot, // destination path of the files
    schema // config object to replace variable in file templates
  );

  if (e2eTestRunner !== 'none') {
    const e2eFullyQualifiedName = `${fullyQualifiedName}-e2e`;
    const e2eRoot = readProjectConfiguration(tree, e2eFullyQualifiedName).root;
    generateFiles(
      tree, // the virtual file system
      joinPathFragments(__dirname, `./files/e2e/${e2eTestRunner}`), // path to the file templates
      e2eRoot, // destination path of the files
      { ...schema, ...names(fullyQualifiedName) }
    );
    configureTsProject(tree, {
      fullyQualifiedName: e2eFullyQualifiedName,
      dir: e2eRoot,
    });
  }

  const viteConfigPath = joinPathFragments(libraryRoot, 'vite.config.ts');
  const viteConfigContents = tree.read(viteConfigPath)?.toString();

  if (viteConfigContents) {
    let viteConfigUpdatedContents = viteConfigContents;

    if (schema.unitTestRunner === 'vitest') {
      viteConfigUpdatedContents = tsquery
        .map(
          ast(viteConfigContents),
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
                        factory.createObjectLiteralExpression()
                      ),
                    ],
                    true
                  )
                ),
                ...node.properties,
              ],
              true
            );
          }
        )
        .getFullText();
    }

    if (schema.bundler === 'vite') {
      viteConfigUpdatedContents = tsquery
        .map(
          ast(viteConfigUpdatedContents),
          'ObjectLiteralExpression',
          (node: ObjectLiteralExpression) => {
            const updatedProperties = node.properties.map((prop) => {
              if (
                isPropertyAssignment(prop) &&
                prop.name.getText() === 'build'
              ) {
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
                              websiteContentPath
                            )
                          )
                        );
                      }
                      return buildProp;
                    }),
                    true
                  )
                );
              }
              return prop;
            });
            return factory.createObjectLiteralExpression(
              updatedProperties,
              true
            );
          }
        )
        .getFullText();
    }

    if (viteConfigContents !== viteConfigUpdatedContents) {
      tree.write(viteConfigPath, viteConfigUpdatedContents);
    }
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
    })
  );

  updateJson(
    tree,
    joinPathFragments(websiteContentPath, 'tsconfig.app.json'),
    (tsconfig) => ({
      ...tsconfig,
      compilerOptions: {
        ...tsconfig.compilerOptions,
        lib: ['DOM'],
      },
    })
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-northstar/ui',
      '@cloudscape-design/components',
      '@cloudscape-design/board-components',
      'react-router-dom',
    ]),
    {}
  );

  await formatFilesInSubtree(tree, websiteContentPath);

  return () => {
    if (!schema.skipInstall) {
      installPackagesTask(tree);
    }
  };
}

export default appGenerator;
