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
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsTrpcApiGeneratorSchema } from './schema';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import tsProjectGenerator from '../../ts/lib/generator';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { kebabCase, toClassName } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { addApiGatewayConstruct } from '../../utils/api-constructs/api-constructs';
import { assignPort } from '../../utils/port';

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

  const backendName = apiNameKebabCase;
  const backendProjectName = `${apiNamespace}${backendName}`;

  await tsProjectGenerator(tree, {
    name: backendName,
    directory: options.directory,
  });

  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    backendProjectName,
  );
  const backendRoot = projectConfig.root;

  const port = assignPort(tree, projectConfig, 2022);

  const enhancedOptions = {
    backendProjectName,
    backendProjectAlias: toScopeAlias(backendProjectName),
    apiNameKebabCase,
    apiNameClassName,
    backendRoot,
    pkgMgrCmd: getPackageManagerCommand().exec,
    apiGatewayEventType: getApiGatewayEventType(options),
    port,
    ...options,
  };

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
    auth: options.auth,
  });

  projectConfig.metadata = {
    ...projectConfig.metadata,
    apiName: options.name,
    apiType: 'trpc',
    auth: options.auth,
  } as unknown;

  projectConfig.targets.serve = {
    executor: 'nx:run-commands',
    options: {
      commands: ['tsx --watch src/local-server.ts'],
      cwd: backendRoot,
    },
    continuous: true,
  };

  projectConfig.targets.bundle = {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${backendRoot}/bundle`],
    options: {
      command: `esbuild ${backendRoot}/src/router.ts --bundle --outfile=dist/${backendRoot}/bundle/index.js --platform=node --format=cjs`,
    },
  };
  projectConfig.targets.build.dependsOn = [
    ...(projectConfig.targets.build.dependsOn ?? []),
    'bundle',
  ];

  projectConfig.targets = sortObjectKeys(projectConfig.targets);

  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

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
    joinPathFragments(__dirname, 'files'),
    backendRoot,
    enhancedOptions,
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  tree.delete(joinPathFragments(backendRoot, 'src', 'lib'));

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
    withVersions([
      '@types/aws-lambda',
      'esbuild',
      'tsx',
      'cors',
      '@types/cors',
    ]),
  );
  tree.delete(joinPathFragments(backendRoot, 'package.json'));

  addGeneratorMetadata(tree, backendName, TRPC_BACKEND_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [TRPC_BACKEND_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}

const getApiGatewayEventType = (options: TsTrpcApiGeneratorSchema): string => {
  if (options.computeType === 'ServerlessApiGatewayRestApi') {
    return 'APIGatewayProxyEvent';
  }
  if (options.auth === 'IAM') {
    return 'APIGatewayProxyEventV2WithIAMAuthorizer';
  } else if (options.auth === 'Cognito') {
    return 'APIGatewayProxyEventV2WithJWTAuthorizer';
  }
  return 'APIGatewayProxyEventV2';
};

export default tsTrpcApiGenerator;
