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
  Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { LambdaFunctionProjectGeneratorSchema } from './schema';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import { parse, stringify } from '@iarna/toml';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import {
  toClassName,
  toDotNotation,
  toKebabCase,
  toSnakeCase,
} from '../../utils/names';
import { addStarExport } from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import { getNpmScope } from '../../utils/npm-scope';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';

export const LAMBDA_FUNCTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

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
  schema: { moduleName: string; functionName: string; functionPath?: string },
): LambdaFunctionDetails => {
  const scope = toSnakeCase(getNpmScope(tree));
  const normalizedFunctionName = toSnakeCase(schema.functionName);
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
export const lambdaFunctionProjectGenerator = async (
  tree: Tree,
  schema: LambdaFunctionProjectGeneratorSchema,
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

  const {
    fullyQualifiedFunctionName,
    normalizedFunctionName,
    normalizedFunctionPath,
  } = getLambdaFunctionDetails(tree, {
    moduleName,
    functionName: schema.functionName,
    functionPath: schema.functionPath,
  });

  const constructFunctionName = `${normalizedProjectName}_${normalizedFunctionName}`;
  const constructFunctionClassName = toClassName(constructFunctionName);
  const constructFunctionKebabCase = toKebabCase(constructFunctionName);
  const lambdaFunctionClassName = toClassName(schema.functionName);

  const functionPath = joinPathFragments(
    projectConfig.sourceRoot,
    schema.functionPath ?? '',
    `${normalizedFunctionName}.py`,
  );

  // Check that the project does not already have a lambda handler
  if (tree.exists(functionPath)) {
    throw new Error(
      `This project already has a a lambda function with the name ${normalizedFunctionName}. Please remove the lambda function before running this generator or use a different name.`,
    );
  }

  await sharedConstructsGenerator(tree);

  const enhancedOptions = {
    ...schema,
    dir,
    constructFunctionClassName,
    constructFunctionKebabCase,
    constructHandlerFilePath: normalizedFunctionPath,
    lambdaFunctionClassName,
    lambdaFunctionSnakeCase: normalizedFunctionName,
  };

  // Check if the project has a bundle target and if not add it
  if (!projectConfig.targets?.bundle) {
    projectConfig.targets.bundle = {
      cache: true,
      executor: 'nx:run-commands',
      outputs: [`{workspaceRoot}/dist/${dir}/bundle`],
      options: {
        commands: [
          `uv export --frozen --no-dev --no-editable --project ${normalizedProjectName} -o dist/${dir}/bundle/requirements.txt`,
          `uv pip install -n --no-installer-metadata --no-compile-bytecode --python-platform x86_64-manylinux2014 --target dist/${dir}/bundle -r dist/${dir}/bundle/requirements.txt`,
        ],
        parallel: false,
      },
      dependsOn: ['compile'],
    };
  }

  if (projectConfig.targets?.build) {
    projectConfig.targets.build.dependsOn = [
      ...(projectConfig.targets.build.dependsOn ?? []).filter(
        (t) => t !== 'bundle',
      ),
      'bundle',
    ];
  }

  projectConfig.targets = sortObjectKeys(projectConfig.targets);
  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  // Generate the lambda handler file
  generateFiles(
    tree, // the virtual file system
    joinPathFragments(__dirname, 'files', 'handler'), // path to the file templates
    joinPathFragments(projectConfig.sourceRoot, schema.functionPath ?? ''),
    enhancedOptions,
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  // Generate the lambda handler test file
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'tests'),
    joinPathFragments(dir, 'tests'),
    enhancedOptions,
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  if (
    !tree.exists(
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'lambda-functions',
        `${constructFunctionKebabCase}.ts`,
      ),
    )
  ) {
    generateFiles(
      tree,
      joinPathFragments(
        __dirname,
        'files',
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
      ),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'app'),
      enhancedOptions,
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'index.ts',
      ),
      './lambda-functions/index.js',
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'lambda-functions',
        'index.ts',
      ),
      `./${constructFunctionKebabCase}.js`,
    );
  }

  updateJson(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
    (config: ProjectConfiguration) => {
      if (!config.targets) {
        config.targets = {};
      }
      if (!config.targets.build) {
        config.targets.build = {};
      }
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []).filter(
          (t) => t !== `${projectConfig.name}:build`,
        ),
        `${projectConfig.name}:build`,
      ];
      return config;
    },
  );

  const projectToml = parse(
    tree.read(joinPathFragments(dir, 'pyproject.toml'), 'utf8'),
  ) as UVPyprojectToml;

  // Check if the project already has the dependencies and add them if not
  const dependencies = projectToml.project?.dependencies || [];

  if (!dependencies.includes('aws-lambda-powertools')) {
    dependencies.push('aws-lambda-powertools');
  }

  if (!dependencies.includes('aws-lambda-powertools[tracer]')) {
    dependencies.push('aws-lambda-powertools[tracer]');
  }

  if (!dependencies.includes('aws-lambda-powertools[parser]')) {
    dependencies.push('aws-lambda-powertools[parser]');
  }

  tree.write(joinPathFragments(dir, 'pyproject.toml'), stringify(projectToml));

  await addGeneratorMetricsIfApplicable(tree, [LAMBDA_FUNCTION_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return async () => {
    await new UVProvider(tree.root, new Logger(), tree).install();
    installPackagesTask(tree);
  };
};
export default lambdaFunctionProjectGenerator;
