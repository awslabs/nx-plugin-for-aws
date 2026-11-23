/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import tsContainerGenerator from '../../ts/container/generator.js';
import tsProjectGenerator from '../../ts/lib/generator.js';
import { addTsDependencies } from '../../utils/add-dependencies.js';
import {
  API_CONSTRUCTS_DEPENDENCIES,
  API_CONSTRUCTS_PY_DEPENDENCIES,
  addApiGatewayInfra,
} from '../../utils/api-constructs/api-constructs.js';
import { addTrpcOperationsMetadataTarget } from '../../utils/api-constructs/trpc-operations-metadata.js';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../utils/bundle/bundle.js';
import {
  CONTAINER_HEALTH_CHECK_PATH,
  CONTAINER_PORT,
} from '../../utils/container-constructs/container-constructs.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { esmVars } from '../../utils/module-format.js';
import { kebabCase, toClassName } from '../../utils/names.js';
import { getNpmScopePrefix } from '../../utils/npm-scope.js';
import {
  addArtifactDependencyToTargets,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { assertSupportedNxVersion } from '../../utils/nx-version.js';
import { sortObjectKeys } from '../../utils/object.js';
import { getPackageManagerDisplayCommands } from '../../utils/pkg-manager.js';
import { assignPort } from '../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import type { IacMetadata } from '../../utils/shared-constructs-constants.js';
import type { TsTrpcApiGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TsTrpcApiMetadata extends IacMetadata {
  readonly apiName: string;
  readonly apiType: string;
  readonly auth: TsTrpcApiGeneratorSchema['auth'];
  readonly infra: TsTrpcApiGeneratorSchema['infra'];
  readonly integrationPattern: 'isolated' | 'shared';
}

// Each entry names the branch it belongs to, so the same declaration drives both
// adding and the version sync.
export const DEPENDENCIES = declareDependencies<TsTrpcApiMetadata>()({
  ts: [
    { name: 'aws-xray-sdk-core' },
    { name: 'zod' },
    { name: '@aws-lambda-powertools/logger' },
    { name: '@aws-lambda-powertools/metrics' },
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@aws-lambda-powertools/tracer' },
    { name: '@aws-sdk/client-appconfigdata' },
    { name: '@trpc/server' },
    { name: '@trpc/client' },
    { name: 'aws4fetch' },
    { name: '@aws-sdk/credential-providers' },
    // The custom authorizer handler wraps itself with middy and parses its event.
    { name: '@middy/core', when: (m) => m.auth === 'custom' },
    { name: '@aws-lambda-powertools/parser', when: (m) => m.auth === 'custom' },
    { name: '@types/aws-lambda', dev: true },
    { name: 'cors', dev: true },
    { name: '@types/cors', dev: true },
    // tsx runs the local server from the workspace root.
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(API_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(BUNDLE_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: ownedElsewhere(API_CONSTRUCTS_PY_DEPENDENCIES),
});

export const TRPC_BACKEND_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

const VALID_TRPC_INTEGRATION_PERMUTATIONS = new Set([
  'rest-lambda::isolated',
  'rest-lambda::shared',
  'http-lambda::isolated',
  'http-lambda::shared',
  // One container service answers every operation, so there is nothing for the
  // isolated pattern to isolate. `getIntegrationPattern` resolves http-ecs to
  // shared whatever the caller asked for, so this is the only reachable
  // http-ecs permutation.
  'http-ecs::shared',
  'none::isolated',
  'none::shared',
]);

export async function tsTrpcApiGenerator(
  tree: Tree,
  options: TsTrpcApiGeneratorSchema,
) {
  assertSupportedNxVersion(tree);
  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    options.infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

  if (options.infra !== 'none') {
    warnIfEcsIgnoresIntegrationPattern(options);
    validateTrpcInfraAndIntegrationPatternCombination(options);
  }

  // The ECS variant runs the API as a long-lived HTTP server in a container,
  // which only the CDK provider vends today.
  const isEcs = options.infra === 'http-ecs';
  if (isEcs && iac !== 'cdk') {
    throw new Error(
      `infra 'http-ecs' is only implemented for the cdk IaC provider, and this workspace resolved iac '${iac}'. Pass --iac=cdk, or choose rest-lambda or http-lambda for terraform.`,
    );
  }

  const apiNamespace = getNpmScopePrefix(tree);
  const apiNameKebabCase = kebabCase(options.name);
  const apiNameClassName = toClassName(options.name);

  // The container service is a component of the API project. Suffixed so its
  // construct class cannot collide with the API construct of the same name.
  const containerName = `${apiNameKebabCase}-container`;
  const containerClassName = toClassName(containerName);

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
      preferInstallDependencies: false,
    });
  }

  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    backendProjectName,
  );
  const backendRoot = projectConfig.root;

  if (!projectExists) {
    // Clear the placeholder barrel from ts#project so the API's own is written.
    tree.delete(joinPathFragments(backendRoot, 'src', 'index.ts'));
  }

  // Reserved before ts#container runs, so the API keeps the port tRPC projects
  // use and ts#container assigns its own above it.
  const port = assignPort(tree, projectConfig, 2022);

  if (isEcs) {
    // Persisted so ts#container sees the port this project already holds.
    updateProjectConfiguration(tree, projectConfig.name, projectConfig);
    // ts#container vends a sample server at the same paths and keeps whatever
    // is already there, so the tRPC server is written before it runs.
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files-ecs-server'),
      joinPathFragments(backendRoot, 'src', containerName),
      {
        containerPort: CONTAINER_PORT,
        healthCheckPath: CONTAINER_HEALTH_CHECK_PATH,
        ...esmVars(tree),
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
    await tsContainerGenerator(tree, {
      project: backendProjectName,
      name: containerName,
      infra: 'ecs',
      iac: options.iac,
      preferInstallDependencies: false,
    });
    // ts#container writes its targets and its assigned port straight to the
    // project, so they are read back before this generator adds its own.
    Object.assign(
      projectConfig,
      readProjectConfigurationUnqualified(tree, backendProjectName),
    );
  }

  const enhancedOptions = {
    backendProjectName,
    backendProjectAlias: backendProjectName,
    apiNameKebabCase,
    apiNameClassName,
    backendRoot,
    pkgMgrCmd: getPackageManagerDisplayCommands().exec,
    apiGatewayEventType: getApiGatewayEventType(options),
    port,
    ...options,
    ...esmVars(tree),
  };

  if (options.infra !== 'none') {
    await sharedConstructsGenerator(
      tree,
      {
        iac,
      },
      DEPENDENCIES,
    );

    await addApiGatewayInfra(
      tree,
      {
        apiProjectName: backendProjectName,
        apiNameClassName,
        apiNameKebabCase,
        constructType: isEcs
          ? 'http-ecs'
          : options.infra === 'http-lambda'
            ? 'http'
            : 'rest',
        backend: {
          type: 'trpc',
          projectAlias: enhancedOptions.backendProjectAlias,
          projectRoot: backendRoot,
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
        ...(isEcs && {
          ecs: {
            serviceClassName: containerClassName,
            serviceFileKebabCase: containerName,
            containerPort: CONTAINER_PORT,
            healthCheckPath: CONTAINER_HEALTH_CHECK_PATH,
          },
        }),
        iac,
      },
      DEPENDENCIES,
    );
  }

  // Recorded on the project below and read by the declaration's predicates, so
  // the packages added here are exactly the ones the version sync will own.
  const metadata: TsTrpcApiMetadata = {
    apiName: options.name,
    apiType: 'trpc',
    auth: options.auth,
    infra: options.infra,
    integrationPattern: getIntegrationPattern(options),
    ...(iac ? { iac } : {}),
  };

  projectConfig.metadata = {
    ...projectConfig.metadata,
    ...metadata,
  } as unknown;

  if (isEcs) {
    // The container's entry point is the API's server, so the project's own
    // serve target runs it: ts#container's equivalent target is dropped rather
    // than leaving two copies of the same server to start.
    delete projectConfig.targets[`${containerName}-serve`];
    const devDependsOn = (projectConfig.targets['dev']?.dependsOn ?? []).filter(
      (target) => target !== `${containerName}-serve`,
    );
    if (devDependsOn.length > 0) {
      projectConfig.targets['dev'].dependsOn = devDependsOn;
    } else {
      // ts#container created `dev` only to run the target just removed, so it
      // is rebuilt below from the serve target alone.
      delete projectConfig.targets['dev'];
    }
  }

  projectConfig.targets.serve = {
    executor: 'nx:run-commands',
    continuous: true,
    options: {
      commands: [
        isEcs
          ? `tsx --watch src/${containerName}/index.ts`
          : 'tsx --watch src/local-server.ts',
      ],
      cwd: '{projectRoot}',
      // The container entry point reads its port and bind address from the
      // environment, and defaults to loopback when HOST is unset.
      ...(isEcs && { env: { PORT: `${port}` } }),
    },
  };

  projectConfig.targets['dev'] = {
    ...projectConfig.targets['dev'],
    ...projectConfig.targets.serve,
    options: {
      ...projectConfig.targets.serve.options,
      env: {
        ...projectConfig.targets.serve.options.env,
        LOCAL_DEV: 'true',
      },
    },
  };

  if (options.infra !== 'none') {
    // The ECS variant has no Lambda handler to bundle: ts#container bundles the
    // container's entry point instead.
    if (!isEcs) {
      await addTypeScriptBundleTarget(
        tree,
        projectConfig,
        {
          targetFilePath: 'src/handler.ts',
          external: [/@aws-sdk\/.*/], // lambda runtime provides aws sdk
        },
        DEPENDENCIES,
      );
    }

    if (options.auth === 'custom') {
      await addTypeScriptBundleTarget(
        tree,
        projectConfig,
        {
          targetFilePath: 'src/authorizer.ts',
          bundleOutputDir: 'authorizer',
          external: [/@aws-sdk\/.*/],
        },
        DEPENDENCIES,
      );
    }

    addArtifactDependencyToTargets(projectConfig, 'bundle');

    // Terraform defines one Lambda function per operation from a generated
    // metadata file; CDK derives the same information from the router's types.
    if (iac === 'terraform' && getIntegrationPattern(options) === 'isolated') {
      addTrpcOperationsMetadataTarget(tree, {
        apiNameKebabCase,
        project: projectConfig,
        templateOptions: esmVars(tree),
      });
    }
  }

  projectConfig.targets = sortObjectKeys(projectConfig.targets);

  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  // The API's source is user-owned, so a re-run leaves existing files alone.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    backendRoot,
    enhancedOptions,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  tree.delete(joinPathFragments(backendRoot, 'src', 'lib'));

  if (options.infra !== 'none' && options.auth === 'custom') {
    // Both HTTP API variants take the HTTP API authorizer event and response.
    const authorizerType = options.infra === 'rest-lambda' ? 'rest' : 'http';
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
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

  if (isEcs) {
    // On ECS the API runs as a long-lived HTTP server, so the Lambda handler
    // and the separate local server entry point have no part to play: the
    // container's own entry point is what runs, deployed and locally.
    tree.delete(joinPathFragments(backendRoot, 'src', 'handler.ts'));
    tree.delete(joinPathFragments(backendRoot, 'src', 'local-server.ts'));
  }

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: backendRoot,
  });
  addGeneratorMetadata(
    tree,
    backendName,
    TRPC_BACKEND_GENERATOR_INFO,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [TRPC_BACKEND_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
}

// On ECS one container service answers every operation, so the isolated
// pattern has nothing to isolate. An explicit `--integrationPattern=isolated`
// is reported and dropped rather than failing the generator.
const warnIfEcsIgnoresIntegrationPattern = (
  options: TsTrpcApiGeneratorSchema,
) => {
  if (
    options.infra === 'http-ecs' &&
    options.integrationPattern === 'isolated'
  ) {
    logger.warn(
      `infra 'http-ecs' runs one container service that answers every operation, so integrationPattern 'isolated' is ignored and 'shared' is used instead.`,
    );
  }
};

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
  // One container service answers every operation, leaving the isolated
  // pattern nothing to isolate, so http-ecs always resolves to shared: both
  // when the option is omitted (the schema has no default) and when it is set
  // to isolated, which `warnIfEcsIgnoresIntegrationPattern` reports.
  if (options.infra === 'http-ecs') {
    return 'shared';
  }
  return options.integrationPattern ?? 'isolated';
};

const getApiGatewayEventType = (
  options: TsTrpcApiGeneratorSchema,
): string | undefined => {
  // On ECS a load balancer forwards the request, so no API Gateway event
  // reaches the server and the vended context names no event type at all.
  if (options.infra === 'http-ecs') {
    return undefined;
  }
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
