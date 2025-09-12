/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsLambdaFunctionGeneratorSchema } from './schema';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { toClassName, toKebabCase, pascalCase } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { withVersions } from '../../utils/versions';
import camelCase from 'lodash.camelcase';
import { TS_HANDLER_RETURN_TYPES } from './io';
import { addEsbuildBundleTarget } from '../../utils/esbuild';
import { addLambdaFunctionInfra } from '../../utils/function-constructs/function-constructs';
import { resolveIacProvider } from '../../utils/iac';

export const TS_LAMBDA_FUNCTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

/**
 * Generates a TypeScript Lambda Function to add to a TypeScript project
 */
export const tsLambdaFunctionGenerator = async (
  tree: Tree,
  schema: TsLambdaFunctionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    schema.project,
  );

  const tsconfigPath = joinPathFragments(projectConfig.root, 'tsconfig.json');

  // Check if the project has a tsconfig.json file
  if (!tree.exists(tsconfigPath)) {
    throw new Error(
      `This generator does not support selected project ${schema.project}. The project must be a typescript project (ie contain a tsconfig.json)`,
    );
  }

  if (!projectConfig.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  const dir = projectConfig.root;
  const projectNameWithOutScope = projectConfig.name.split('/').pop();
  const projectNameKebabCase = toKebabCase(projectNameWithOutScope);
  const functionNameKebabCase = toKebabCase(schema.functionName);

  const constructFunctionNameKebabCase = `${projectNameKebabCase}-${functionNameKebabCase}`;
  const constructFunctionClassName = toClassName(
    constructFunctionNameKebabCase,
  );
  const lambdaFunctionCamelCase = camelCase(schema.functionName);
  const lambdaFunctionClassName = pascalCase(schema.functionName);
  const lambdaFunctionKebabCase = toKebabCase(schema.functionName);

  const functionPath = joinPathFragments(
    projectConfig.sourceRoot,
    schema.functionPath ?? '',
    `${lambdaFunctionKebabCase}.ts`,
  );

  // Check that the project does not already have a lambda handler
  if (tree.exists(functionPath)) {
    throw new Error(
      `This project already has a lambda function with the name ${functionNameKebabCase}. Please remove the lambda function before running this generator or use a different name.`,
    );
  }

  const iacProvider = await resolveIacProvider(tree, schema.iacProvider);

  await sharedConstructsGenerator(tree, {
    iacProvider,
  });

  // Add bundle-<name> target for this specific lambda function
  const bundleTargetName = `bundle-${lambdaFunctionKebabCase}`;

  addLambdaFunctionInfra(tree, {
    functionProjectName: projectConfig.name,
    functionNameClassName: constructFunctionClassName,
    functionNameKebabCase: constructFunctionNameKebabCase,
    handler: 'index.handler',
    runtime: 'node',
    bundlePathFromRoot: joinPathFragments('dist', dir, bundleTargetName),
    iacProvider,
  });

  const enhancedOptions = {
    ...schema,
    lambdaFunctionCamelCase,
    lambdaFunctionClassName,
    lambdaFunctionKebabCase,
    returnType: TS_HANDLER_RETURN_TYPES[schema.eventSource],
  };

  // Add a bundle target for the function
  addEsbuildBundleTarget(projectConfig, {
    bundleTargetName,
    targetFilePath: functionPath,
    extraEsbuildArgs: '--external:@aws-sdk/*',
  });

  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  // Generate the lambda handler file
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'handler'),
    joinPathFragments(projectConfig.sourceRoot, schema.functionPath ?? ''),
    enhancedOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-lambda-powertools/tracer',
      '@aws-lambda-powertools/logger',
      '@aws-lambda-powertools/metrics',
      '@aws-lambda-powertools/parser',
      '@middy/core',
      'zod',
    ]),
    withVersions(['esbuild', '@types/aws-lambda']),
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_LAMBDA_FUNCTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  return () => {
    installPackagesTask(tree);
  };
};

export default tsLambdaFunctionGenerator;
