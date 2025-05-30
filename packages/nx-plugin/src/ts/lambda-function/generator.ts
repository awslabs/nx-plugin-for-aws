import {
  generateFiles,
  joinPathFragments,
  Tree,
  updateProjectConfiguration,
  OverwriteStrategy,
  ProjectConfiguration,
  updateJson,
} from '@nx/devkit';
import { TsLambdaFunctionSchema } from './schema';
import { formatFilesInSubtree } from '../../utils/format';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import {
  toClassName,
  toKebabCase,
} from '../../utils/names';
import { addStarExport } from '../../utils/ast';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';

export const LAMBDA_FUNCTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsLambdaFunctionGenerator = async (
  tree: Tree,
  options: TsLambdaFunctionSchema,
) => {
  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    options.project,
  );

  if (!projectConfig.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  const dir = projectConfig.root;
  const projectNameWithOutScope = projectConfig.name.split('.').pop();
  const normalizedProjectName = toKebabCase(projectNameWithOutScope);
  const functionPath = options.functionPath || 'lambda-functions';
  const functionNameKebabCase = toKebabCase(options.functionName);
  const functionNamePascalCase = toClassName(options.functionName);
  const constructFunctionName = `${normalizedProjectName}-${functionNameKebabCase}`;
  const constructFunctionClassName = toClassName(constructFunctionName);
  const constructFunctionKebabCase = toKebabCase(constructFunctionName);

  const handlerFilePath = joinPathFragments(
    projectConfig.sourceRoot,
    functionPath,
    `${functionNameKebabCase}.ts`,
  );

  // Check that the project does not already have a lambda handler
  if (tree.exists(handlerFilePath)) {
    throw new Error(
      `This project already has a lambda function with the name ${functionNameKebabCase}. Please remove the lambda function before running this generator or use a different name.`,
    );
  }

  await sharedConstructsGenerator(tree);

  const enhancedOptions = {
    ...options,
    dir,
    functionNameKebabCase,
    functionNamePascalCase,
    functionPath,
    handlerType: options.handlerType || 'APIGatewayProxyHandler',
    projectName: normalizedProjectName,
    constructFunctionClassName,
    constructFunctionKebabCase,
  };

  // Check if the project has a bundle target and if not add it
  if (!projectConfig.targets?.bundle) {
    projectConfig.targets = projectConfig.targets || {};
    projectConfig.targets.bundle = {
      cache: true,
      executor: '@nx/esbuild:esbuild',
      outputs: [`{workspaceRoot}/dist/${dir}/bundle`],
      options: {
        main: `${projectConfig.sourceRoot}/${functionPath}/${functionNameKebabCase}.ts`,
        outputPath: `dist/${dir}/bundle`,
        bundle: true,
        platform: 'node',
        format: ['cjs'],
        outExtension: {
          '.js': '.js',
        },
        esbuildOptions: {
          outdir: `dist/${dir}/bundle`,
          entryNames: functionNameKebabCase,
        },
      },
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
    tree,
    joinPathFragments(__dirname, 'files', 'handler'),
    joinPathFragments(projectConfig.sourceRoot, functionPath),
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

  // Generate CDK construct
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

  // Add dependencies to package.json
  const packageJsonPath = joinPathFragments(dir, 'package.json');
  if (tree.exists(packageJsonPath)) {
    const packageJson = JSON.parse(tree.read(packageJsonPath, 'utf-8') || '{}');

    // Add @types/aws-lambda as dev dependency
    packageJson.devDependencies = packageJson.devDependencies || {};
    packageJson.devDependencies['@types/aws-lambda'] = '^8.10.143';

    // Add testing dependencies
    if (!packageJson.devDependencies['vitest']) {
      packageJson.devDependencies['vitest'] = '^2.0.0';
    }

    tree.write(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  await addGeneratorMetricsIfApplicable(tree, [LAMBDA_FUNCTION_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
};

export default tsLambdaFunctionGenerator;