/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type ProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addPyDependencies } from '../../utils/add-dependencies.js';
import {
  API_CONSTRUCTS_DEPENDENCIES,
  API_CONSTRUCTS_PY_DEPENDENCIES,
  addApiGatewayInfra,
} from '../../utils/api-constructs/api-constructs.js';
import { addSharedConstructsOpenApiMetadataGenerateTarget } from '../../utils/api-constructs/open-api-metadata.js';
import {
  addPythonBundleTarget,
  pythonBundleTargetName,
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
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { toClassName, toKebabCase, toSnakeCase } from '../../utils/names.js';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../utils/nx.js';
import { assertSupportedNxVersion } from '../../utils/nx-version.js';
import { sortObjectKeys } from '../../utils/object.js';
import { assignPort } from '../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import type { IacMetadata } from '../../utils/shared-constructs-constants.js';
import pyContainerGenerator from '../container/generator.js';
import pyProjectGenerator, {
  getPyProjectDetails,
} from '../project/generator.js';
import { addOpenApiGeneration } from './react/open-api.js';
import type { PyFastApiProjectGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface PyFastApiMetadata extends IacMetadata {
  readonly apiName: string;
  readonly apiType: string;
  readonly auth: PyFastApiProjectGeneratorSchema['auth'];
}

export const DEPENDENCIES = declareDependencies<PyFastApiMetadata>()({
  ts: [
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(API_CONSTRUCTS_DEPENDENCIES),
  ],
  py: [
    { name: 'fastapi' },
    { name: 'uvicorn' },
    { name: 'aws-lambda-powertools' },
    { name: 'aws-lambda-powertools[tracer]' },
    // The custom authorizer handler parses its event with the parser extra.
    {
      name: 'aws-lambda-powertools[parser]',
      when: (m) => m.auth === 'custom',
    },
    // `fastapi dev` runs the local server.
    { name: 'fastapi[standard]', group: 'dev' },
    ...ownedElsewhere(API_CONSTRUCTS_PY_DEPENDENCIES),
  ],
});

export const FAST_API_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Generates a Python FastAPI project
 */
export const pyFastApiProjectGenerator = async (
  tree: Tree,
  schema: PyFastApiProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  assertSupportedNxVersion(tree);
  warnIfEcsIgnoresIntegrationPattern(schema);
  const integrationPattern = getIntegrationPattern(schema);

  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    schema.infra !== 'none' ? await resolveIac(tree, schema.iac) : undefined;

  // The ECS variant runs the API as a long-lived uvicorn server in a
  // container, which only the CDK provider vends today.
  const isEcs = schema.infra === 'http-ecs';
  if (isEcs && iac !== 'cdk') {
    throw new Error(
      `infra 'http-ecs' is only implemented for the cdk IaC provider, and this workspace resolved iac '${iac}'. Pass --iac=cdk, or choose rest-lambda or http-lambda for terraform.`,
    );
  }

  const { dir, normalizedModuleName, fullyQualifiedName } = getPyProjectDetails(
    tree,
    {
      name: schema.name,
      directory: schema.directory,
      subDirectory: schema.subDirectory,
      moduleName: schema.moduleName,
    },
  );
  const apiNameKebabCase = toKebabCase(schema.name);
  const apiNameClassName = toClassName(schema.name);

  // The container service is a component of the API project. Suffixed so its
  // construct class cannot collide with the API construct of the same name.
  const containerName = `${apiNameKebabCase}-container`;
  const containerClassName = toClassName(containerName);
  const containerModuleName = toSnakeCase(containerName);

  let projectExists: boolean;
  try {
    readProjectConfiguration(tree, fullyQualifiedName);
    projectExists = true;
  } catch {
    projectExists = false;
  }

  if (!projectExists) {
    await pyProjectGenerator(tree, {
      name: schema.name,
      directory: schema.directory,
      subDirectory: schema.subDirectory,
      moduleName: normalizedModuleName,
      type: 'application',
      preferInstallDependencies: false,
    });
  }

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  // Reserved before py#container runs, so the API keeps the port FastAPI
  // projects use and py#container assigns its own above it.
  const port = assignPort(tree, projectConfig, 8000);

  if (isEcs) {
    // Persisted so py#container sees the port this project already holds.
    updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);
    // py#container vends a sample server at the same path and keeps whatever
    // is already there, so the API's server is written before it runs.
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files-ecs-server'),
      joinPathFragments(dir, normalizedModuleName, containerModuleName),
      {
        apiNameClassName,
        containerPort: CONTAINER_PORT,
        healthCheckPath: CONTAINER_HEALTH_CHECK_PATH,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
    await pyContainerGenerator(tree, {
      project: fullyQualifiedName,
      name: containerName,
      infra: 'ecs',
      iac: schema.iac,
      preferInstallDependencies: false,
    });
    // py#container writes its targets and its assigned port straight to the
    // project, so they are read back before this generator adds its own.
    Object.assign(
      projectConfig,
      readProjectConfiguration(tree, fullyQualifiedName),
    );
  }

  // Bundle for the Lambda platform, built only for what still runs in Lambda:
  // the API itself on the Lambda variants, and the custom authorizer handler.
  // py#container builds the arm64 bundle the container image is made from.
  const bundleOutputDir = joinPathFragments(
    'dist',
    dir,
    pythonBundleTargetName(),
  );
  if (!isEcs || schema.auth === 'custom') {
    const { bundleTargetName } = addPythonBundleTarget(projectConfig);

    if (!isEcs) {
      // Add a command to copy run.sh to the bundle output for Lambda Web Adapter
      const fs = new FsCommands(tree, DEPENDENCIES);
      const bundleTarget = projectConfig.targets[bundleTargetName];
      const copyRunShCommand = fs.cpFile(
        `{projectRoot}/run.sh`,
        `dist/{projectRoot}/${bundleTargetName}/run.sh`,
      );
      if (!bundleTarget.options.commands.includes(copyRunShCommand)) {
        bundleTarget.options.commands = [
          ...bundleTarget.options.commands,
          copyRunShCommand,
        ];
      }
    }
  }

  if (isEcs) {
    // The container's entry point is the API's server, so the project's own
    // serve target runs it: py#container's equivalent target is dropped rather
    // than leaving two copies of the same server to start.
    delete projectConfig.targets[`${containerName}-serve`];
    const devDependsOn = (projectConfig.targets['dev']?.dependsOn ?? []).filter(
      (target) => target !== `${containerName}-serve`,
    );
    if (devDependsOn.length > 0) {
      projectConfig.targets['dev'].dependsOn = devDependsOn;
    } else {
      // py#container created `dev` only to run the target just removed, so it
      // is rebuilt below from the serve target alone.
      delete projectConfig.targets['dev'];
    }
  }

  projectConfig.targets.serve = {
    executor: '@nxlv/python:run-commands',
    continuous: true,
    options: {
      // No --reload on the container entry point: the reloader's supervisor
      // keeps the port after SIGTERM.
      command: isEcs
        ? `uv run python -m ${normalizedModuleName}.${containerModuleName}.main`
        : `uv run fastapi dev ${normalizedModuleName}/main.py --port ${port}`,
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

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const metadata: PyFastApiMetadata = {
    apiName: schema.name,
    apiType: 'fast-api',
    auth: schema.auth,
    ...(iac ? { iac } : {}),
  };

  projectConfig.metadata = {
    ...projectConfig.metadata,
    ...metadata,
  } as any;

  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);

  // Add OpenAPI spec generation to the project, run as part of build
  const { specPath } = addOpenApiGeneration(tree, { project: projectConfig });

  [
    joinPathFragments(dir, normalizedModuleName, 'hello.py'),
    joinPathFragments(dir, 'tests', 'test_hello.py'),
  ].forEach((f) => tree.delete(f));

  // User-owned source files: preserve any existing copies so re-running does
  // not clobber user edits (and does not reformat them nondeterministically).
  generateFiles(
    tree, // the virtual file system
    joinPathFragments(import.meta.dirname, 'files', 'app'), // path to the file templates
    dir, // destination path of the files
    {
      name: normalizedModuleName,
      apiNameClassName,
      infra: schema.infra,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  if (isEcs) {
    // run.sh starts uvicorn behind the Lambda Web Adapter, which has no part
    // to play on ECS: the container's own entry point is what runs, deployed
    // and locally.
    tree.delete(joinPathFragments(dir, 'run.sh'));
  }

  if (schema.infra !== 'none') {
    await sharedConstructsGenerator(
      tree,
      {
        iac,
      },
      DEPENDENCIES,
    );

    if (schema.auth === 'custom') {
      // Both HTTP API variants take the HTTP API authorizer event and response.
      const authorizerType = schema.infra === 'rest-lambda' ? 'rest' : 'http';
      generateFiles(
        tree,
        joinPathFragments(
          import.meta.dirname,
          '..',
          '..',
          'utils',
          'api-constructs',
          'files',
          'py-authorizer',
          authorizerType,
        ),
        joinPathFragments(dir, normalizedModuleName),
        {},
        {
          overwriteStrategy: OverwriteStrategy.KeepExisting,
        },
      );
    }

    // Add the CDK construct to deploy the FastAPI to shared constructs
    await addApiGatewayInfra(
      tree,
      {
        apiProjectName: projectConfig.name,
        apiNameClassName,
        apiNameKebabCase,
        constructType: isEcs
          ? 'http-ecs'
          : schema.infra === 'http-lambda'
            ? 'http'
            : 'rest',
        backend: {
          type: 'fastapi',
          moduleName: normalizedModuleName,
          bundleOutputDir,
          integrationPattern,
        },
        auth: schema.auth,
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

    addSharedConstructsOpenApiMetadataGenerateTarget(tree, {
      iac,
      apiNameKebabCase,
      specPath,
      specBuildTargetName: `${projectConfig.name}:openapi`,
      integrationPattern,
    });
  }

  addPyDependencies(tree, DEPENDENCIES, { metadata, projectRoot: dir });

  addGeneratorMetadata(tree, fullyQualifiedName, FAST_API_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [FAST_API_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return () =>
    installDependencies(tree, schema.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

// On ECS one container service answers every operation, so the isolated
// pattern has nothing to isolate. An explicit `--integrationPattern=isolated`
// is reported and dropped rather than failing the generator.
const warnIfEcsIgnoresIntegrationPattern = (
  schema: PyFastApiProjectGeneratorSchema,
) => {
  if (schema.infra === 'http-ecs' && schema.integrationPattern === 'isolated') {
    logger.warn(
      `infra 'http-ecs' runs one container service that answers every operation, so integrationPattern 'isolated' is ignored and 'shared' is used instead.`,
    );
  }
};

const getIntegrationPattern = (
  schema: PyFastApiProjectGeneratorSchema,
): 'isolated' | 'shared' => {
  // One container service answers every operation, leaving the isolated
  // pattern nothing to isolate, so http-ecs always resolves to shared: both
  // when the option is omitted (the schema has no default) and when it is set
  // to isolated, which `warnIfEcsIgnoresIntegrationPattern` reports.
  if (schema.infra === 'http-ecs') {
    return 'shared';
  }
  return schema.integrationPattern ?? 'isolated';
};

export default pyFastApiProjectGenerator;
