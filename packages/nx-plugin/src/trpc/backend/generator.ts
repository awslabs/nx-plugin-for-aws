/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
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
  'none::isolated',
  'none::shared',
]);

export async function tsTrpcApiGenerator(
  tree: Tree,
  options: TsTrpcApiGeneratorSchema,
) {
  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    options.infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

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
      preferInstallDependencies: false,
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

  projectConfig.targets.serve = {
    executor: 'nx:run-commands',
    continuous: true,
    options: {
      commands: ['tsx --watch src/local-server.ts'],
      cwd: '{projectRoot}',
    },
  };

  projectConfig.targets['dev'] = {
    ...projectConfig.targets['dev'],
    ...projectConfig.targets.serve,
    options: {
      ...projectConfig.targets.serve.options,
      env: {
        LOCAL_DEV: 'true',
      },
    },
  };

  if (options.infra !== 'none') {
    await addTypeScriptBundleTarget(
      tree,
      projectConfig,
      {
        targetFilePath: 'src/handler.ts',
        external: [/@aws-sdk\/.*/], // lambda runtime provides aws sdk
      },
      DEPENDENCIES,
    );

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

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
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
