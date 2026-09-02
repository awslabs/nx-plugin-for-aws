/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
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
import { addPythonBundleTarget } from '../../utils/bundle/bundle.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { toClassName, toKebabCase } from '../../utils/names.js';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../utils/nx.js';
import { sortObjectKeys } from '../../utils/object.js';
import { assignPort } from '../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import type { IacMetadata } from '../../utils/shared-constructs-constants.js';
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
  const integrationPattern = getIntegrationPattern(schema);

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
  const port = assignPort(tree, projectConfig, 8000);

  const { bundleOutputDir, bundleTargetName } =
    addPythonBundleTarget(projectConfig);

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

  projectConfig.targets.serve = {
    executor: '@nxlv/python:run-commands',
    continuous: true,
    options: {
      command: `uv run fastapi dev ${normalizedModuleName}/main.py --port ${port}`,
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

  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    schema.infra !== 'none' ? await resolveIac(tree, schema.iac) : undefined;

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

  if (schema.infra !== 'none') {
    await sharedConstructsGenerator(
      tree,
      {
        iac,
      },
      DEPENDENCIES,
    );

    if (schema.auth === 'custom') {
      const authorizerType = schema.infra === 'http-lambda' ? 'http' : 'rest';
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
        constructType: schema.infra === 'http-lambda' ? 'http' : 'rest',
        backend: {
          type: 'fastapi',
          moduleName: normalizedModuleName,
          bundleOutputDir,
          integrationPattern,
        },
        auth: schema.auth,
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

const getIntegrationPattern = (
  schema: PyFastApiProjectGeneratorSchema,
): 'isolated' | 'shared' => schema.integrationPattern ?? 'isolated';

export default pyFastApiProjectGenerator;
