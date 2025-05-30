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
import { TsLambdaFunctionGeneratorSchema } from './schema';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import {
  toClassName,
  toKebabCase,
  pascalCase,
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
  readonly normalizedFunctionName: string;
  readonly fullyQualifiedFunctionName: string;
  readonly normalizedFunctionPath: string;
}

const getLambdaFunctionDetails = (
  tree: Tree,
  schema: { functionName: string; functionPath?: string },
  projectConfig: ProjectConfiguration,
): LambdaFunctionDetails => {
  const scope = getNpmScope(tree);
  const normalizedFunctionName = toKebabCase(schema.functionName);
  const fullyQualifiedFunctionName = `${scope}/${normalizedFunctionName}`;
  
  const functionFileName = `${normalizedFunctionName}.handler`;
  const normalizedFunctionPath = schema.functionPath 
    ? `${schema.functionPath.replace(/\/$/, '')}/${functionFileName}`
    : functionFileName;

  return {
    fullyQualifiedFunctionName,
    normalizedFunctionName,
    normalizedFunctionPath,
  };
};

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

  const packageJsonPath = joinPathFragments(projectConfig.root, 'package.json');

  // Check if the project has a package.json file
  if (!tree.exists(packageJsonPath)) {
    throw new Error(
      `This generator does not support selected project ${schema.project}. The project must be a TypeScript project with a package.json file.`,
    );
  }

  if (!projectConfig.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  const dir = projectConfig.root;
  const projectNameWithOutScope = projectConfig.name.split('.').pop();
  const normalizedProjectName = toKebabCase(projectNameWithOutScope);

  const {
    fullyQualifiedFunctionName,
    normalizedFunctionName,
    normalizedFunctionPath,
  } = getLambdaFunctionDetails(tree, schema, projectConfig);

  const constructFunctionName = `${normalizedProjectName}_${normalizedFunctionName.replace(/-/g, '_')}`;
  const constructFunctionClassName = toClassName(constructFunctionName);
  const constructFunctionKebabCase = toKebabCase(constructFunctionName);
  const functionNamePascalCase = pascalCase(schema.functionName);
  const functionNameKebabCase = normalizedFunctionName;

  const functionPath = joinPathFragments(
    projectConfig.sourceRoot,
    schema.functionPath ?? '',
    `${functionNameKebabCase}.ts`,
  );

  // Check that the project does not already have a lambda handler
  if (tree.exists(functionPath)) {
    throw new Error(
      `This project already has a lambda function with the name ${normalizedFunctionName}. Please remove the lambda function before running this generator or use a different name.`,
    );
  }

  await sharedConstructsGenerator(tree);

  const enhancedOptions = {
    ...schema,
    dir,
    constructFunctionClassName,
    constructFunctionKebabCase,
    constructHandlerFilePath: normalizedFunctionPath,
    functionNamePascalCase,
    functionNameKebabCase,
    fullyQualifiedFunctionName,
    normalizedFunctionName,
  };

  // Check if the project has bundle targets and add them
  if (!projectConfig.targets) {
    projectConfig.targets = {};
  }

  // Add function-specific bundle target
  const functionBundleTargetName = `bundle-${functionNameKebabCase}`;
  if (!projectConfig.targets[functionBundleTargetName]) {
    projectConfig.targets[functionBundleTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      outputs: [`{workspaceRoot}/dist/${dir}/bundle/${functionNameKebabCase}`],
      options: {
        commands: [
          `esbuild ${projectConfig.sourceRoot}/${schema.functionPath ? `${schema.functionPath}/` : ''}${functionNameKebabCase}.ts --bundle --outdir=dist/${dir}/bundle/${functionNameKebabCase} --platform=node --format=cjs --target=node20 --sourcemap`,
        ],
        parallel: false,
      },
      dependsOn: ['compile'],
    };
  }

  // Update or create main bundle target
  if (!projectConfig.targets.bundle) {
    projectConfig.targets.bundle = {
      cache: true,
      executor: 'nx:run-commands',
      outputs: [`{workspaceRoot}/dist/${dir}/bundle`],
      options: {
        commands: [],
        parallel: true,
      },
      dependsOn: [functionBundleTargetName],
    };
  } else {
    // Add dependency on the function-specific bundle target
    const existingDependsOn = projectConfig.targets.bundle.dependsOn || [];
    if (!existingDependsOn.includes(functionBundleTargetName)) {
      projectConfig.targets.bundle.dependsOn = [...existingDependsOn, functionBundleTargetName];
    }
  }

  // Update build target to depend on bundle
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
    tree,
    joinPathFragments(__dirname, 'files', 'handler'),
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

  // Generate construct if it doesn't exist
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

  // Update shared constructs build dependency
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

  // Add required dependencies to package.json
  updateJson(tree, packageJsonPath, (packageJson) => {
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }
    if (!packageJson.devDependencies) {
      packageJson.devDependencies = {};
    }

    // Add @types/aws-lambda if not present
    if (!packageJson.dependencies['@types/aws-lambda'] && !packageJson.devDependencies['@types/aws-lambda']) {
      packageJson.devDependencies['@types/aws-lambda'] = '^8.10.143';
    }

    // Add vitest if not present (for testing)
    if (!packageJson.dependencies['vitest'] && !packageJson.devDependencies['vitest']) {
      packageJson.devDependencies['vitest'] = '^2.0.5';
    }

    return packageJson;
  });

  await addGeneratorMetricsIfApplicable(tree, [LAMBDA_FUNCTION_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);

  return () => {
    installPackagesTask(tree);
  };
};

export default tsLambdaFunctionGenerator;