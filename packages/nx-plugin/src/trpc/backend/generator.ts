/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  ProjectConfiguration,
  Tree,
  updateJson,
} from '@nx/devkit';
import { TrpcBackendGeneratorSchema } from './schema';
import kebabCase from 'lodash.kebabcase';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { factory, SourceFile } from 'typescript';
import { ast, tsquery } from '@phenomnomnominal/tsquery';
import tsLibGenerator from '../../ts/lib/generator';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { getRelativePathToRoot } from '../../utils/paths';
import { formatFilesInSubtree } from '../../utils/format';

const toClassName = (str: string): string => {
  const words = str.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/);

  return words
    .map((word, index) => {
      if (index === 0 && /^\d/.test(word)) {
        return '_' + word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('');
};

export async function trpcBackendGenerator(
  tree: Tree,
  options: TrpcBackendGeneratorSchema
) {
  await sharedConstructsGenerator(tree);

  const apiNameKebabCase = kebabCase(options.apiName);
  const apiNameClassName = toClassName(options.apiName);
  const projectRoot = joinPathFragments(
    options.directory ?? '.',
    apiNameKebabCase
  );
  const relativePathToProjectRoot = `${joinPathFragments(
    getRelativePathToRoot(tree, `${getNpmScopePrefix(tree)}common-constructs`),
    projectRoot
  )}`;
  const schemaRoot = joinPathFragments(projectRoot, 'schema');
  const backendRoot = joinPathFragments(projectRoot, 'backend');

  const backendName = `${apiNameKebabCase}-backend`;
  const schemaName = `${apiNameKebabCase}-schema`;

  const backendProjectName = `${options.apiNamespace}/${backendName}`;
  const schemaProjectName = `${options.apiNamespace}/${schemaName}`;
  const enhancedOptions = {
    backendProjectName,
    backendProjectAlias: toScopeAlias(backendProjectName),
    schemaProjectName,
    schemaProjectAlias: toScopeAlias(schemaProjectName),
    apiNameKebabCase,
    apiNameClassName,
    relativePathToProjectRoot,
    ...options,
  };

  await tsLibGenerator(tree, {
    scope: options.apiNamespace,
    name: backendName,
    directory: projectRoot,
    subDirectory: 'backend',
    unitTestRunner: options.unitTestRunner,
  });

  await tsLibGenerator(tree, {
    scope: options.apiNamespace,
    name: schemaName,
    directory: projectRoot,
    subDirectory: 'schema',
    unitTestRunner: options.unitTestRunner,
  });

  const constructsPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    apiNameKebabCase,
    'index.ts'
  );

  if (!tree.exists(constructsPath)) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
      enhancedOptions
    );

    addDependenciesToPackageJson(
      tree,
      withVersions(['constructs', 'aws-cdk-lib']),
      {}
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

    const apiExportDeclaration = factory.createExportDeclaration(
      undefined,
      undefined,
      undefined,
      factory.createStringLiteral(`./${apiNameKebabCase}/index.js`)
    );
    const updatedIndex = tsquery
      .map(
        ast(sharedConstructsIndexContents),
        'SourceFile',
        (node: SourceFile) => {
          return {
            ...node,
            statements: [apiExportDeclaration, ...node.statements],
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
    joinPathFragments(backendRoot, 'project.json'),
    (config: ProjectConfiguration) => {
      config.metadata = {
        apiName: options.apiName,
      } as unknown;

      return config;
    }
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'backend'),
    backendRoot,
    enhancedOptions
  );
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'schema'),
    schemaRoot,
    enhancedOptions
  );

  tree.delete(joinPathFragments(backendRoot, 'src', 'lib'));
  tree.delete(joinPathFragments(schemaRoot, 'src', 'lib'));

  addDependenciesToPackageJson(
    tree,
    withVersions([
      'zod',
      '@trpc/server',
      'aws-xray-sdk-core',
      'aws-cdk-lib',
      'constructs',
      '@aws-lambda-powertools/logger',
      '@aws-lambda-powertools/metrics',
      '@aws-lambda-powertools/tracer',
    ]),
    withVersions(['@types/aws-lambda'])
  );

  tree.delete(joinPathFragments(backendRoot, 'package.json'));
  tree.delete(joinPathFragments(schemaRoot, 'package.json'));

  await formatFilesInSubtree(tree, projectRoot);

  return () => {
    installPackagesTask(tree);
  };
}

export default trpcBackendGenerator;
