/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { formatFilesInSubtree } from '../../utils/format';
import { addLambdaFunctionInfra } from '../../utils/function-constructs/function-constructs';
import { resolveIac } from '../../utils/iac';
import { installDeps } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import {
  toClassName,
  toDotNotation,
  toKebabCase,
  toSnakeCase,
} from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { toProjectRelativePath } from '../../utils/paths';
import { addDependenciesToPyProjectToml } from '../../utils/py';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import type { PyLambdaFunctionGeneratorSchema } from './schema';

export const LAMBDA_FUNCTION_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export interface LambdaFunctionDetails {
  /**
   * The normalized name of the lambda handler project
   */
  readonly normalizedFunctionName: string;
  /**
   * The full package name of the lambda handler construct
   */
  readonly fullyQualifiedFunctionName: string;
  /**
   * The normalized python path to the lambda handler file in dot notation (e.g. `app.lambda_functions.lambda_handler`)
   */
  readonly normalizedFunctionPath: string;
}

const getLambdaFunctionDetails = (
  tree: Tree,
  schema: { moduleName: string; name: string; functionPath?: string },
): LambdaFunctionDetails => {
  const scope = toSnakeCase(getNpmScope(tree));
  const normalizedFunctionName = toSnakeCase(schema.name);
  const fullyQualifiedFunctionName = `${scope}.${normalizedFunctionName}`;
  const normalizedFunctionPath = `${schema.moduleName}.${schema.functionPath ? `${toDotNotation(schema.functionPath)}.` : ''}${normalizedFunctionName}.lambda_handler`;

  return {
    fullyQualifiedFunctionName,
    normalizedFunctionName,
    normalizedFunctionPath,
  };
};

/**
 * Generates a Python Lambda Function to add to a python project
 */
export const pyLambdaFunctionGenerator = async (
  tree: Tree,
  schema: PyLambdaFunctionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    schema.project,
  );

  const pyProjectPath = joinPathFragments(projectConfig.root, 'pyproject.toml');

  // Check if the project has a pyproject.toml file
  if (!pyProjectPath) {
    throw new Error(
      `This generator does not support selected project ${schema.project}`,
    );
  }

  if (!projectConfig.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  const dir = projectConfig.root;
  const projectNameWithOutScope = projectConfig.name.split('.').pop();
  const normalizedProjectName = toSnakeCase(projectNameWithOutScope);

  // Module name is the last part of the source root,
  const sourceParts = projectConfig.sourceRoot.split('/');
  const moduleName = sourceParts[sourceParts.length - 1];

  const { normalizedFunctionName, normalizedFunctionPath } =
    getLambdaFunctionDetails(tree, {
      moduleName,
      name: schema.name,
      functionPath: schema.functionPath,
    });

  const constructFunctionName = `${normalizedProjectName}_${normalizedFunctionName}`;
  const constructFunctionClassName = toClassName(constructFunctionName);
  const constructFunctionKebabCase = toKebabCase(constructFunctionName);
  const lambdaFunctionClassName = toClassName(schema.name);
  const lambdaFunctionKebabCase = toKebabCase(schema.name);

  const functionPath = joinPathFragments(
    projectConfig.sourceRoot,
    schema.functionPath ?? '',
    `${normalizedFunctionName}.py`,
  );

  const infra = schema.infra ?? 'lambda';
  const handlerAlreadyExists = tree.exists(functionPath);

  if (handlerAlreadyExists && infra === 'none') {
    throw new Error(
      `This project already has a lambda function with the name ${normalizedFunctionName}. Please remove the lambda function before running this generator or use a different name.`,
    );
  }

  // Check if the project has a bundle target and if not add it
  const { bundleOutputDir } = addPythonBundleTarget(projectConfig);

  if (infra !== 'none') {
    const iac = await resolveIac(tree, schema.iac);

    await sharedConstructsGenerator(tree, {
      iac,
    });

    await addLambdaFunctionInfra(tree, {
      functionProjectName: projectConfig.name,
      nameClassName: constructFunctionClassName,
      nameKebabCase: constructFunctionKebabCase,
      handler: normalizedFunctionPath,
      bundlePathFromRoot: bundleOutputDir,
      runtime: 'python',
      iac,
    });
  }

  const enhancedOptions = {
    ...schema,
    dir,
    lambdaFunctionClassName,
    lambdaFunctionSnakeCase: normalizedFunctionName,
  };

  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  // Generate the lambda handler file
  generateFiles(
    tree, // the virtual file system
    joinPathFragments(import.meta.dirname, 'files', 'handler'), // path to the file templates
    joinPathFragments(projectConfig.sourceRoot, schema.functionPath ?? ''),
    enhancedOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Generate the lambda handler test file
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'tests'),
    joinPathFragments(dir, 'tests'),
    enhancedOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPyProjectToml(tree, dir, [
    'aws-lambda-powertools',
    'aws-lambda-powertools[tracer]',
    'aws-lambda-powertools[parser]',
  ]);

  addComponentGeneratorMetadata(
    tree,
    projectConfig.name,
    LAMBDA_FUNCTION_GENERATOR_INFO,
    toProjectRelativePath(projectConfig, functionPath),
    lambdaFunctionKebabCase,
  );

  await addGeneratorMetricsIfApplicable(tree, [LAMBDA_FUNCTION_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return () => installDeps(tree, schema.preferInstallDependencies, {
    languages: ['typescript', 'python'],
  });
};
export default pyLambdaFunctionGenerator;
