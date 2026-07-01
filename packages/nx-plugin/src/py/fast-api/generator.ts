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
import { addApiGatewayInfra } from '../../utils/api-constructs/api-constructs';
import { addSharedConstructsOpenApiMetadataGenerateTarget } from '../../utils/api-constructs/open-api-metadata';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { toClassName, toKebabCase } from '../../utils/names';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { assignPort } from '../../utils/port';
import {
  addDependenciesToDependencyGroupInPyProjectToml,
  addDependenciesToPyProjectToml,
} from '../../utils/py';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import pyProjectGenerator, { getPyProjectDetails } from '../project/generator';
import { addOpenApiGeneration } from './react/open-api';
import type { PyFastApiProjectGeneratorSchema } from './schema';

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
  const fs = new FsCommands(tree);
  const bundleTarget = projectConfig.targets[bundleTargetName];
  const copyRunShCommand = fs.cp(
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

  projectConfig.metadata = {
    ...projectConfig.metadata,
    apiName: schema.name,
    apiType: 'fast-api',
    auth: schema.auth,
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
    const iac = await resolveIac(tree, schema.iac);

    await sharedConstructsGenerator(tree, {
      iac,
    });

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
    await addApiGatewayInfra(tree, {
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
    });

    addSharedConstructsOpenApiMetadataGenerateTarget(tree, {
      iac,
      apiNameKebabCase,
      specPath,
      specBuildTargetName: `${projectConfig.name}:openapi`,
    });
  }

  addDependenciesToPyProjectToml(tree, dir, [
    'fastapi',
    'uvicorn',
    'aws-lambda-powertools',
    'aws-lambda-powertools[tracer]',
    ...(schema.auth === 'custom'
      ? (['aws-lambda-powertools[parser]'] as const)
      : []),
  ]);
  addDependenciesToDependencyGroupInPyProjectToml(tree, dir, 'dev', [
    'fastapi[standard]',
  ]);

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
