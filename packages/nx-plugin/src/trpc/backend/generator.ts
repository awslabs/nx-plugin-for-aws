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
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import tsProjectGenerator from '../../ts/lib/generator';
import { addApiGatewayInfra } from '../../utils/api-constructs/api-constructs';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { formatFilesInSubtree } from '../../utils/format';
import { resolveIac } from '../../utils/iac';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager';
import { assignPort } from '../../utils/port';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { withVersions } from '../../utils/versions';
import type { TsTrpcApiGeneratorSchema } from './schema';

export const TRPC_BACKEND_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const VALID_TRPC_INTEGRATION_PERMUTATIONS = new Set([
  'rest-lambda::isolated',
  'rest-lambda::shared',
  'http-lambda::isolated',
  'http-lambda::shared',
  'none::isolated',
  'none::shared',
]);

export async function tsTrpcApiGenerator(
  tree: Tree,
  options: TsTrpcApiGeneratorSchema,
) {
  if (options.infra !== 'none') {
    validateTrpcInfraAndIntegrationPatternCombination(options);
  }

  const apiNamespace = getNpmScopePrefix(tree);
  const apiNameKebabCase = kebabCase(options.name);
  const apiNameClassName = toClassName(options.name);

  const backendName = apiNameKebabCase;
  const backendProjectName = `${apiNamespace}${backendName}`;

  let projectExists: boolean;
  try {
    readProjectConfigurationUnqualified(tree, backendProjectName);
    projectExists = true;
  } catch {
    projectExists = false;
  }

  if (!projectExists) {
    await tsProjectGenerator(tree, {
      name: backendName,
      directory: options.directory,
      subDirectory: options.subDirectory,
    });
  }

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
    pkgMgrCmd: getPackageManagerDisplayCommands().exec,
    apiGatewayEventType: getApiGatewayEventType(options),
    port,
    ...options,
  };

  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);

    await sharedConstructsGenerator(tree, {
      iac,
    });

    await addApiGatewayInfra(tree, {
      apiProjectName: backendProjectName,
      apiNameClassName,
      apiNameKebabCase,
      constructType: options.infra === 'http-lambda' ? 'http' : 'rest',
      backend: {
        type: 'trpc',
        projectAlias: enhancedOptions.backendProjectAlias,
        bundleOutputDir: joinPathFragments('dist', backendRoot, 'bundle'),
        integrationPattern: getIntegrationPattern(options),
        ...(options.auth === 'custom' && {
          authorizerBundleOutputDir: joinPathFragments(
            'dist',
            backendRoot,
            'bundle',
            'authorizer',
          ),
        }),
      },
      auth: options.auth,
      iac,
    });
  }

  projectConfig.metadata = {
    ...projectConfig.metadata,
    apiName: options.name,
    apiType: 'trpc',
    auth: options.auth,
    infra: options.infra,
    integrationPattern: getIntegrationPattern(options),
  } as unknown;

  projectConfig.targets.serve = {
    executor: 'nx:run-commands',
    options: {
      commands: ['tsx --watch src/local-server.ts'],
      cwd: '{projectRoot}',
    },
    continuous: true,
  };

  projectConfig.targets['serve-local'] = {
    ...projectConfig.targets.serve,
    options: {
      ...projectConfig.targets.serve.options,
      env: {
        SERVE_LOCAL: 'true',
      },
    },
  };

  if (options.infra !== 'none') {
    await addTypeScriptBundleTarget(tree, projectConfig, {
      targetFilePath: 'src/handler.ts',
      external: [/@aws-sdk\/.*/], // lambda runtime provides aws sdk
    });

    if (options.auth === 'custom') {
      await addTypeScriptBundleTarget(tree, projectConfig, {
        targetFilePath: 'src/authorizer.ts',
        bundleOutputDir: 'authorizer',
        external: [/@aws-sdk\/.*/],
      });
    }

    addDependencyToTargetIfNotPresent(projectConfig, 'build', 'bundle');
  }

  projectConfig.targets = sortObjectKeys(projectConfig.targets);

  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

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

  if (options.infra !== 'none' && options.auth === 'custom') {
    const authorizerType = options.infra === 'http-lambda' ? 'http' : 'rest';
    generateFiles(
      tree,
      joinPathFragments(
        __dirname,
        '..',
        '..',
        'utils',
        'api-constructs',
        'files',
        'cdk',
        'authorizer',
        authorizerType,
      ),
      joinPathFragments(backendRoot, 'src'),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }

  // Remove streaming schema helper for HTTP APIs (API Gateway HTTP API doesn't support streaming)
  if (options.infra !== 'rest-lambda' && options.infra !== 'none') {
    tree.delete(
      joinPathFragments(backendRoot, 'src', 'schema', 'z-async-iterable.ts'),
    );
  }

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
      ...(options.auth === 'custom'
        ? (['@middy/core', '@aws-lambda-powertools/parser'] as const)
        : []),
    ]),
    withVersions(['@types/aws-lambda', 'tsx', 'cors', '@types/cors']),
  );
  tree.delete(joinPathFragments(backendRoot, 'package.json'));

  addGeneratorMetadata(tree, backendName, TRPC_BACKEND_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [TRPC_BACKEND_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}

const validateTrpcInfraAndIntegrationPatternCombination = (
  options: TsTrpcApiGeneratorSchema,
) => {
  const integrationPattern = getIntegrationPattern(options);
  const permutation = `${options.infra}::${integrationPattern}`;

  if (!VALID_TRPC_INTEGRATION_PERMUTATIONS.has(permutation)) {
    throw new Error(
      `Invalid tRPC infra/integrationPattern combination: ${options.infra} + ${integrationPattern}.`,
    );
  }
};

const getIntegrationPattern = (
  options: TsTrpcApiGeneratorSchema,
): 'isolated' | 'shared' => {
  return options.integrationPattern ?? 'isolated';
};

const getApiGatewayEventType = (options: TsTrpcApiGeneratorSchema): string => {
  if (options.infra === 'rest-lambda') {
    return 'APIGatewayProxyEvent';
  }
  if (options.auth === 'iam') {
    return 'APIGatewayProxyEventV2WithIAMAuthorizer';
  } else if (options.auth === 'cognito') {
    return 'APIGatewayProxyEventV2WithJWTAuthorizer';
  }
  return 'APIGatewayProxyEventV2';
};

export default tsTrpcApiGenerator;
