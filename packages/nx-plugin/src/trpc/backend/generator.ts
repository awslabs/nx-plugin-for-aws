/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsTrpcApiGeneratorSchema } from './schema';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import tsProjectGenerator from '../../ts/lib/generator';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { kebabCase, toClassName } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { addApiGatewayInfra } from '../../utils/api-constructs/api-constructs';
import { addEcsInfra } from '../../utils/ecs-constructs/ecs-constructs';
import { assignPort } from '../../utils/port';
import { resolveIacProvider } from '../../utils/iac';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';

export const TRPC_BACKEND_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const VALID_TRPC_INTEGRATION_PERMUTATIONS = new Set([
  'ServerlessApiGatewayRestApi::isolated',
  'ServerlessApiGatewayRestApi::shared',
  'ServerlessApiGatewayHttpApi::isolated',
  'ServerlessApiGatewayHttpApi::shared',
  'EcsFargate::isolated',
]);

const isEcsFargate = (options: TsTrpcApiGeneratorSchema) =>
  options.computeType === 'EcsFargate';

export async function tsTrpcApiGenerator(
  tree: Tree,
  options: TsTrpcApiGeneratorSchema,
) {
  validateTrpcComputeTypeAndIntegrationPatternCombination(options);

  const iacProvider = await resolveIacProvider(tree, options.iacProvider);

  await sharedConstructsGenerator(tree, {
    iacProvider,
  });

  const apiNamespace = getNpmScopePrefix(tree);
  const apiNameKebabCase = kebabCase(options.name);
  const apiNameClassName = toClassName(options.name);

  const backendName = apiNameKebabCase;
  const backendProjectName = `${apiNamespace}${backendName}`;

  await tsProjectGenerator(tree, {
    name: backendName,
    directory: options.directory,
    subDirectory: options.subDirectory,
  });

  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    backendProjectName,
  );
  const backendRoot = projectConfig.root;

  const defaultPort = isEcsFargate(options) ? 3000 : 2022;
  const port = assignPort(tree, projectConfig, defaultPort);

  const enhancedOptions = {
    backendProjectName,
    backendProjectAlias: toScopeAlias(backendProjectName),
    apiNameKebabCase,
    apiNameClassName,
    backendRoot,
    pkgMgrCmd: getPackageManagerDisplayCommands().exec,
    apiGatewayEventType: isEcsFargate(options)
      ? undefined
      : getApiGatewayEventType(options),
    port,
    ...options,
  };

  if (isEcsFargate(options)) {
    addEcsInfra(tree, {
      apiProjectName: backendProjectName,
      apiNameClassName,
      apiNameKebabCase,
      backendProjectAlias: enhancedOptions.backendProjectAlias,
      backendRoot,
      port,
      auth: options.auth,
      iacProvider,
    });
  } else {
    await addApiGatewayInfra(tree, {
      apiProjectName: backendProjectName,
      apiNameClassName,
      apiNameKebabCase,
      constructType:
        options.computeType === 'ServerlessApiGatewayHttpApi' ? 'http' : 'rest',
      backend: {
        type: 'trpc',
        projectAlias: enhancedOptions.backendProjectAlias,
        bundleOutputDir: joinPathFragments('dist', backendRoot, 'bundle'),
        integrationPattern: getIntegrationPattern(options),
      },
      auth: options.auth,
      iacProvider,
    });
  }

  projectConfig.metadata = {
    ...projectConfig.metadata,
    apiName: options.name,
    apiType: 'trpc',
    auth: options.auth,
    computeType: options.computeType,
    ...(isEcsFargate(options)
      ? { port }
      : { integrationPattern: getIntegrationPattern(options) }),
  } as unknown;

  projectConfig.targets.serve = {
    executor: 'nx:run-commands',
    options: {
      commands: ['tsx --watch src/local-server.ts'],
      cwd: '{projectRoot}',
    },
    continuous: true,
  };

  if (isEcsFargate(options)) {
    await addTypeScriptBundleTarget(tree, projectConfig, {
      targetFilePath: 'src/server.ts',
    });
  } else {
    await addTypeScriptBundleTarget(tree, projectConfig, {
      targetFilePath: 'src/handler.ts',
      external: [/@aws-sdk\/.*/], // lambda runtime provides aws sdk
    });
  }

  addDependencyToTargetIfNotPresent(projectConfig, 'build', 'bundle');

  projectConfig.targets = sortObjectKeys(projectConfig.targets);

  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  if (isEcsFargate(options)) {
    // Generate ECS-specific template files
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files-ecs'),
      backendRoot,
      enhancedOptions,
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );
  } else {
    // Generate Lambda-specific template files
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files'),
      backendRoot,
      enhancedOptions,
      {
        overwriteStrategy: OverwriteStrategy.Overwrite,
      },
    );
  }

  // Generate shared tRPC template files (router, procedures, schema)
  generateFiles(
    tree,
    joinPathFragments(__dirname, '../../utils/files/trpc'),
    backendRoot,
    enhancedOptions,
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  tree.delete(joinPathFragments(backendRoot, 'src', 'lib'));

  // Remove streaming schema helper for HTTP APIs and ECS (API Gateway HTTP API doesn't support streaming)
  if (options.computeType !== 'ServerlessApiGatewayRestApi') {
    tree.delete(
      joinPathFragments(backendRoot, 'src', 'schema', 'z-async-iterable.ts'),
    );
  }

  if (isEcsFargate(options)) {
    addDependenciesToPackageJson(
      tree,
      withVersions(['zod', '@trpc/server', '@trpc/client', 'fastify']),
      withVersions(['tsx']),
    );
  } else {
    addDependenciesToPackageJson(
      tree,
      withVersions([
        'aws-xray-sdk-core',
        'zod',
        '@aws-lambda-powertools/logger',
        '@aws-lambda-powertools/metrics',
        '@aws-lambda-powertools/parameters',
        '@aws-lambda-powertools/tracer',
        '@aws-sdk/client-appconfigdata',
        '@trpc/server',
        '@trpc/client',
        'aws4fetch',
        '@aws-sdk/credential-providers',
      ]),
      withVersions(['@types/aws-lambda', 'tsx', 'cors', '@types/cors']),
    );
  }
  tree.delete(joinPathFragments(backendRoot, 'package.json'));

  addGeneratorMetadata(tree, backendName, TRPC_BACKEND_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [TRPC_BACKEND_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}

const validateTrpcComputeTypeAndIntegrationPatternCombination = (
  options: TsTrpcApiGeneratorSchema,
) => {
  const integrationPattern = getIntegrationPattern(options);
  const permutation = `${options.computeType}::${integrationPattern}`;

  if (!VALID_TRPC_INTEGRATION_PERMUTATIONS.has(permutation)) {
    throw new Error(
      `Invalid tRPC computeType/integrationPattern combination: ${options.computeType} + ${integrationPattern}.`,
    );
  }
};

const getIntegrationPattern = (
  options: TsTrpcApiGeneratorSchema,
): 'isolated' | 'shared' => {
  return options.integrationPattern ?? 'isolated';
};

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
