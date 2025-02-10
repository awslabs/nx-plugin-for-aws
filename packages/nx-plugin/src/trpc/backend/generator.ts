/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  getPackageManagerCommand,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
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
import tsLibGenerator from '../../ts/lib/generator';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { getRelativePathToRoot } from '../../utils/paths';
import { toClassName } from '../../utils/names';
import { addStarExport } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
export async function trpcBackendGenerator(
  tree: Tree,
  options: TrpcBackendGeneratorSchema,
) {
  await sharedConstructsGenerator(tree);
  const apiNamespace = getNpmScopePrefix(tree);
  const apiNameKebabCase = kebabCase(options.apiName);
  const apiNameClassName = toClassName(options.apiName);
  const projectRoot = joinPathFragments(
    options.directory ?? '.',
    apiNameKebabCase,
  );
  const relativePathToProjectRoot = `${joinPathFragments(
    getRelativePathToRoot(tree, `${getNpmScopePrefix(tree)}common-constructs`),
    projectRoot,
  )}`;
  const schemaRoot = joinPathFragments(projectRoot, 'schema');
  const backendRoot = joinPathFragments(projectRoot, 'backend');
  const backendName = `${apiNameKebabCase}-backend`;
  const schemaName = `${apiNameKebabCase}-schema`;
  const backendProjectName = `${apiNamespace}${backendName}`;
  const schemaProjectName = `${apiNamespace}${schemaName}`;
  const enhancedOptions = {
    backendProjectName,
    backendProjectAlias: toScopeAlias(backendProjectName),
    schemaProjectName,
    schemaProjectAlias: toScopeAlias(schemaProjectName),
    apiNameKebabCase,
    apiNameClassName,
    relativePathToProjectRoot,
    pkgMgrCmd: getPackageManagerCommand().exec,
    ...options,
  };
  await tsLibGenerator(tree, {
    name: backendName,
    directory: projectRoot,
    subDirectory: 'backend',
  });
  await tsLibGenerator(tree, {
    name: schemaName,
    directory: projectRoot,
    subDirectory: 'schema',
  });
  if (
    !tree.exists(
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'trpc-apis',
        `${apiNameKebabCase}.ts`,
      ),
    )
  ) {
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
      enhancedOptions,
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    const shouldGenerateCoreTrpcApiConstruct = !tree.exists(
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'trpc-api.ts',
      ),
    );
    if (shouldGenerateCoreTrpcApiConstruct) {
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
        enhancedOptions,
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
      './trpc-apis/index.js',
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'trpc-apis',
        'index.ts',
      ),
      `./${apiNameKebabCase}.js`,
    );
    if (shouldGenerateCoreTrpcApiConstruct) {
      addStarExport(
        tree,
        joinPathFragments(
          PACKAGES_DIR,
          SHARED_CONSTRUCTS_DIR,
          'src',
          'core',
          'index.ts',
        ),
        './trpc-api.js',
      );
    }
  }

  updateJson(
    tree,
    joinPathFragments(backendRoot, 'project.json'),
    (config: ProjectConfiguration) => {
      config.metadata = {
        apiName: options.apiName,
      } as unknown;
      config.targets = {
        ...config.targets,
        serve: {
          executor: 'nx:run-commands',
          options: {
            commands: ['tsx src/local-server.ts'],
            cwd: backendRoot,
          },
        },
      };
      return config;
    },
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'backend'),
    backendRoot,
    enhancedOptions,
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'schema'),
    schemaRoot,
    enhancedOptions,
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );
  tree.delete(joinPathFragments(backendRoot, 'src', 'lib'));
  tree.delete(joinPathFragments(schemaRoot, 'src', 'lib'));
  addDependenciesToPackageJson(
    tree,
    withVersions([
      'aws-xray-sdk-core',
      'zod',
      '@aws-lambda-powertools/logger',
      '@aws-lambda-powertools/metrics',
      '@aws-lambda-powertools/tracer',
      '@trpc/server',
    ]),
    withVersions(['@types/aws-lambda', 'tsx']),
  );
  tree.delete(joinPathFragments(backendRoot, 'package.json'));
  tree.delete(joinPathFragments(schemaRoot, 'package.json'));
  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default trpcBackendGenerator;
