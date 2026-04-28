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
import {
  getNpmScope,
  getNpmScopePrefix,
  toScopeAlias,
} from '../../utils/npm-scope';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
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
import { addTrpcAgentCoreInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { assignPort } from '../../utils/port';
import { resolveIacProvider } from '../../utils/iac';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { FsCommands } from '../../utils/fs';

export const TRPC_BACKEND_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const VALID_TRPC_INTEGRATION_PERMUTATIONS = new Set([
  'ServerlessApiGatewayRestApi::isolated',
  'ServerlessApiGatewayRestApi::shared',
  'ServerlessApiGatewayHttpApi::isolated',
  'ServerlessApiGatewayHttpApi::shared',
  // Bedrock AgentCore runs the tRPC server as a single container — only the
  // 'isolated' default is a meaningful sentinel; multi-integration patterns
  // do not apply.
  'BedrockAgentCoreRuntimeWebSocket::isolated',
]);

export async function tsTrpcApiGenerator(
  tree: Tree,
  options: TsTrpcApiGeneratorSchema,
) {
  validateTrpcComputeTypeAndIntegrationPatternCombination(options);
  validateTrpcAgentCoreAuth(options);

  const isAgentCore =
    options.computeType === 'BedrockAgentCoreRuntimeWebSocket';
  const isRestApi = options.computeType === 'ServerlessApiGatewayRestApi';

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

  if (isAgentCore) {
    const dockerImageTag = `${getNpmScope(tree)}-${apiNameKebabCase}:latest`;
    const dockerOutputDir = joinPathFragments('dist', backendRoot, 'bundle');

    await addTrpcAgentCoreInfra(tree, {
      apiNameClassName,
      apiNameKebabCase,
      projectName: backendProjectName,
      dockerImageTag,
      dockerOutputDir,
      auth: options.auth as 'IAM' | 'Cognito',
      iacProvider,
    });
  } else {
    await addApiGatewayInfra(tree, {
      apiProjectName: backendProjectName,
      apiNameClassName,
      apiNameKebabCase,
      constructType: isRestApi ? 'rest' : 'http',
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
    ...(isAgentCore
      ? {}
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

  await addTypeScriptBundleTarget(tree, projectConfig, {
    targetFilePath: isAgentCore ? 'src/handler-agentcore.ts' : 'src/handler.ts',
    external: isAgentCore ? undefined : [/@aws-sdk\/.*/], // lambda runtime provides aws sdk
  });

  if (isAgentCore) {
    const dockerOutputDir = joinPathFragments('dist', backendRoot, 'bundle');
    const dockerImageTag = `${getNpmScope(tree)}-${apiNameKebabCase}:latest`;
    const fs = new FsCommands(tree);

    projectConfig.targets.docker = {
      cache: true,
      outputs: [`{workspaceRoot}/${dockerOutputDir}/Dockerfile`],
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.cp(
            joinPathFragments(backendRoot, 'Dockerfile'),
            joinPathFragments(dockerOutputDir, 'Dockerfile'),
          ),
          `docker build --platform linux/arm64 -t ${dockerImageTag} ${dockerOutputDir}`,
        ],
        parallel: false,
      },
      dependsOn: ['bundle'],
    };

    addDependencyToTargetIfNotPresent(projectConfig, 'build', 'docker');
  }

  addDependencyToTargetIfNotPresent(projectConfig, 'build', 'bundle');

  projectConfig.targets = sortObjectKeys(projectConfig.targets);

  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    backendRoot,
    {
      ...enhancedOptions,
      adotVersion:
        TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'],
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  tree.delete(joinPathFragments(backendRoot, 'src', 'lib'));

  // The Lambda and AgentCore compute types each need only one of the two
  // handler templates — delete the other so the project doesn't carry dead code
  if (isAgentCore) {
    tree.delete(joinPathFragments(backendRoot, 'src', 'handler.ts'));
  } else {
    tree.delete(joinPathFragments(backendRoot, 'src', 'handler-agentcore.ts'));
    tree.delete(joinPathFragments(backendRoot, 'Dockerfile'));
  }

  // The streaming schema helper is only useful for compute types that support
  // streaming responses (API Gateway REST API and Bedrock AgentCore runtime).
  if (options.computeType === 'ServerlessApiGatewayHttpApi') {
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
      ...(isAgentCore ? (['ws'] as const) : []),
    ]),
    withVersions([
      'tsx',
      'cors',
      '@types/cors',
      ...(isAgentCore
        ? (['@types/ws'] as const)
        : (['@types/aws-lambda'] as const)),
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

const validateTrpcAgentCoreAuth = (options: TsTrpcApiGeneratorSchema) => {
  if (
    options.computeType === 'BedrockAgentCoreRuntimeWebSocket' &&
    options.auth === 'None'
  ) {
    throw new Error(
      `Bedrock AgentCore runtime only supports IAM or Cognito auth — auth='None' cannot be combined with computeType='BedrockAgentCoreRuntimeWebSocket'.`,
    );
  }
};

const getIntegrationPattern = (
  options: TsTrpcApiGeneratorSchema,
): 'isolated' | 'shared' => {
  return options.integrationPattern ?? 'isolated';
};

const getApiGatewayEventType = (options: TsTrpcApiGeneratorSchema): string => {
  if (options.computeType === 'BedrockAgentCoreRuntimeWebSocket') {
    // AgentCore does not sit behind API Gateway — the field is unused
    // by the middleware and handler templates in this mode.
    return 'never';
  }
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
