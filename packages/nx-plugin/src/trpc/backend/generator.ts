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
import { TsTrpcApiGeneratorSchema } from './schema';
import kebabCase from 'lodash.kebabcase';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import tsProjectGenerator from '../../ts/lib/generator';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { toClassName } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { addApiGatewayConstruct } from '../../utils/api-constructs/api-constructs';

export const TRPC_BACKEND_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsTrpcApiGenerator(
  tree: Tree,
  options: TsTrpcApiGeneratorSchema,
) {
  await sharedConstructsGenerator(tree);

  const apiNamespace = getNpmScopePrefix(tree);
  const apiNameKebabCase = kebabCase(options.name);
  const apiNameClassName = toClassName(options.name);
  const projectRoot = joinPathFragments(
    options.directory ?? '.',
    apiNameKebabCase,
  );

  const schemaRoot = joinPathFragments(projectRoot, 'schema');
  const backendRoot = joinPathFragments(projectRoot, 'backend');
  const backendName = apiNameKebabCase;
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
  await tsProjectGenerator(tree, {
    name: backendName,
    directory: projectRoot,
    subDirectory: 'backend',
  });
  await tsProjectGenerator(tree, {
    name: schemaName,
    directory: projectRoot,
    subDirectory: 'schema',
  });

  addApiGatewayConstruct(tree, {
    apiNameClassName,
    apiNameKebabCase,
    constructType:
      options.computeType === 'ServerlessApiGatewayHttpApi' ? 'http' : 'rest',
    backend: {
      type: 'trpc',
      projectAlias: enhancedOptions.backendProjectAlias,
      dir: backendRoot,
    },
  });

  updateJson(
    tree,
    joinPathFragments(backendRoot, 'project.json'),
    (config: ProjectConfiguration) => {
      config.metadata = {
        apiName: options.name,
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
      '@trpc/client',
      'aws4fetch',
      '@aws-sdk/credential-providers',
    ]),
    withVersions(['@types/aws-lambda', 'esbuild', 'tsx']),
  );
  tree.delete(joinPathFragments(backendRoot, 'package.json'));
  tree.delete(joinPathFragments(schemaRoot, 'package.json'));

  await addGeneratorMetricsIfApplicable(tree, [TRPC_BACKEND_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default tsTrpcApiGenerator;
