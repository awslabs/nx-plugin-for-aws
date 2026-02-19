/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  ProjectConfiguration,
  readProjectConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PyFastApiProjectGeneratorSchema } from './schema';
import { UVProvider, Logger } from '../../utils/nxlv-python';
import pyProjectGenerator, { getPyProjectDetails } from '../project/generator';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { toClassName, toKebabCase } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addGeneratorMetadata,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { addApiGatewayInfra } from '../../utils/api-constructs/api-constructs';
import { addOpenApiGeneration } from './react/open-api';
import { assignPort } from '../../utils/port';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import {
  addDependenciesToDependencyGroupInPyProjectToml,
  addDependenciesToPyProjectToml,
} from '../../utils/py';
import { resolveIacProvider } from '../../utils/iac';
import { addSharedConstructsOpenApiMetadataGenerateTarget } from '../../utils/api-constructs/open-api-metadata';

export const FAST_API_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

/**
 * Generates a Python FastAPI project
 */
export const pyFastApiProjectGenerator = async (
  tree: Tree,
  schema: PyFastApiProjectGeneratorSchema,
): Promise<GeneratorCallback> => {
  const iacProvider = await resolveIacProvider(tree, schema.iacProvider);

  await sharedConstructsGenerator(tree, {
    iacProvider,
  });

  const { dir, normalizedModuleName, fullyQualifiedName } = getPyProjectDetails(
    tree,
    {
      name: schema.name,
      directory: schema.directory,
      moduleName: schema.moduleName,
    },
  );
  const apiNameKebabCase = toKebabCase(schema.name);
  const apiNameClassName = toClassName(schema.name);

  await pyProjectGenerator(tree, {
    name: schema.name,
    directory: schema.directory,
    moduleName: normalizedModuleName,
    projectType: 'application',
  });

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const port = assignPort(tree, projectConfig, 8000);

  const { bundleOutputDir } = addPythonBundleTarget(projectConfig);

  projectConfig.targets.serve = {
    executor: '@nxlv/python:run-commands',
    options: {
      command: `uv run fastapi dev ${normalizedModuleName}/main.py --port ${port}`,
      cwd: '{projectRoot}',
    },
    continuous: true,
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

  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files', 'app'), // path to the file templates
    dir, // destination path of the files
    {
      name: normalizedModuleName,
      apiNameClassName,
      computeType: schema.computeType,
    },
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  // Add the CDK construct to deploy the FastAPI to shared constructs
  addApiGatewayInfra(tree, {
    apiProjectName: projectConfig.name,
    apiNameClassName,
    apiNameKebabCase,
    constructType:
      schema.computeType === 'ServerlessApiGatewayHttpApi' ? 'http' : 'rest',
    backend: {
      type: 'fastapi',
      moduleName: normalizedModuleName,
      bundleOutputDir,
    },
    auth: schema.auth,
    iacProvider,
  });

  addSharedConstructsOpenApiMetadataGenerateTarget(tree, {
    iacProvider,
    apiNameKebabCase,
    specPath,
    specBuildTargetName: `${projectConfig.name}:openapi`,
  });

  addDependenciesToPyProjectToml(tree, dir, [
    'fastapi',
    'mangum',
    'aws-lambda-powertools',
    'aws-lambda-powertools[tracer]',
  ]);
  addDependenciesToDependencyGroupInPyProjectToml(tree, dir, 'dev', [
    'fastapi[standard]',
  ]);

  addGeneratorMetadata(tree, fullyQualifiedName, FAST_API_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [FAST_API_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return async () => {
    await new UVProvider(tree.root, new Logger(), tree).install();
    installPackagesTask(tree);
  };
};
export default pyFastApiProjectGenerator;
