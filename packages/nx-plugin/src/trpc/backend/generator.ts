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
import { toClassName } from '../../utils/names';
import { addStarExport } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { addHttpApi } from '../../utils/http-api';
import { sortObjectKeys } from '../../utils/nx';
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
    backendRoot,
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
        'http-apis',
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

    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'index.ts',
      ),
      './http-apis/index.js',
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'http-apis',
        'index.ts',
      ),
      `./${apiNameKebabCase}.js`,
    );
  }
  addHttpApi(tree, apiNameClassName);

  updateJson(
    tree,
    joinPathFragments(backendRoot, 'project.json'),
    (config: ProjectConfiguration) => {
      config.metadata = {
        apiName: options.apiName,
        apiType: 'trpc',
      } as unknown;

      config.targets.serve = {
        executor: 'nx:run-commands',
        options: {
          commands: ['tsx src/local-server.ts'],
          cwd: backendRoot,
        },
      };

      config.targets.bundle = {
        cache: true,
        executor: 'nx:run-commands',
        outputs: [`{workspaceRoot}/dist/${backendRoot}/bundle`],
        options: {
          command: `esbuild ${backendRoot}/src/router.ts --bundle --outfile=dist/${backendRoot}/bundle/index.js --platform=node --format=cjs`,
        },
      };
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []),
        'bundle',
      ];

      config.targets = sortObjectKeys(config.targets);
      return config;
    },
  );

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
        `${backendProjectName}:build`,
      ];
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
      'aws4fetch',
      '@aws-sdk/credential-providers',
    ]),
    withVersions(['@types/aws-lambda', 'esbuild', 'tsx']),
  );
  tree.delete(joinPathFragments(backendRoot, 'package.json'));
  tree.delete(joinPathFragments(schemaRoot, 'package.json'));
  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default trpcBackendGenerator;
