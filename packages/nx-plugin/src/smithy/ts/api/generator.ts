/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  Tree,
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsSmithyApiGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { formatFilesInSubtree } from '../../../utils/format';
import { resolveIacProvider } from '../../../utils/iac';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { toClassName, toKebabCase } from '../../../utils/names';
import tsProjectGenerator, { getTsLibDetails } from '../../../ts/lib/generator';
import { assignPort } from '../../../utils/port';
import { withVersions } from '../../../utils/versions';
import smithyProjectGenerator from '../../project/generator';
import { addTypeScriptBundleTarget } from '../../../utils/bundle/bundle';
import { updateGitIgnore } from '../../../utils/git';
import { addIgnoresToEslintConfig } from '../../../ts/lib/eslint';
import { FsCommands } from '../../../utils/fs';
import { addApiGatewayInfra } from '../../../utils/api-constructs/api-constructs';
import { addSharedConstructsOpenApiMetadataGenerateTarget } from '../../../utils/api-constructs/open-api-metadata';

export const TS_SMITHY_API_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsSmithyApiGenerator = async (
  tree: Tree,
  options: TsSmithyApiGeneratorSchema,
): Promise<GeneratorCallback> => {
  const apiNameClassName = toClassName(options.name);
  const apiNameKebabCase = toKebabCase(options.name);
  const { fullyQualifiedName: backendFullyQualifiedName, dir } =
    getTsLibDetails(tree, options);
  const modelProjectName = `${apiNameKebabCase}-model`;

  // Generate the model project
  await smithyProjectGenerator(tree, {
    name: modelProjectName,
    serviceName: apiNameClassName,
    namespace: options.namespace,
    directory: dir,
    subDirectory: 'model',
  });

  // Add metadata to associate backend project with model project
  const modelProjectConfig = readProjectConfigurationUnqualified(
    tree,
    modelProjectName,
  );
  updateProjectConfiguration(tree, modelProjectConfig.name, {
    ...modelProjectConfig,
    metadata: {
      ...modelProjectConfig.metadata,
      backendProject: backendFullyQualifiedName,
    } as any,
  });

  // Generate the backend project
  await tsProjectGenerator(tree, {
    name: options.name,
    directory: dir,
    subDirectory: 'backend',
  });

  addGeneratorMetadata(
    tree,
    backendFullyQualifiedName,
    TS_SMITHY_API_GENERATOR_INFO,
    {
      apiName: options.name,
      auth: options.auth,
      modelProject: modelProjectConfig.name,
    },
  );

  const backendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    backendFullyQualifiedName,
  );
  const port = assignPort(tree, backendProjectConfig, 3001);

  // Delete default index.ts with "hello" function
  tree.delete(joinPathFragments(backendProjectConfig.sourceRoot, 'index.ts'));

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    backendProjectConfig.sourceRoot,
    {
      apiNameClassName,
      port,
    },
  );

  // Add infrastructure
  const iacProvider = await resolveIacProvider(tree, options.iacProvider);
  await sharedConstructsGenerator(tree, {
    iacProvider,
  });
  addApiGatewayInfra(tree, {
    iacProvider,
    apiProjectName: backendFullyQualifiedName,
    apiNameClassName,
    apiNameKebabCase,
    auth: options.auth,
    constructType: 'rest', // While possible in theory, Smithy doesn't support HTTP APIs
    backend: {
      type: 'smithy',
      bundleOutputDir: joinPathFragments(
        'dist',
        backendProjectConfig.root,
        'bundle',
      ),
    },
  });
  addSharedConstructsOpenApiMetadataGenerateTarget(tree, {
    iacProvider,
    apiNameKebabCase,
    specPath: joinPathFragments(
      'dist',
      modelProjectConfig.root,
      'build',
      'openapi',
      'openapi.json',
    ),
    specBuildTargetName: `${modelProjectConfig.name}:build`,
  });

  // Add bundle target using rolldown
  addTypeScriptBundleTarget(tree, backendProjectConfig, {
    targetFilePath: 'src/handler.ts',
  });

  const cmd = new FsCommands(tree);
  const generatedSrcDirFromRoot = joinPathFragments(
    backendProjectConfig.sourceRoot,
    'generated',
  );

  // Target for copying the ssdk built by the model
  backendProjectConfig.targets['copy-ssdk'] = {
    cache: true,
    inputs: [
      {
        dependentTasksOutputFiles: '**/*',
      },
    ],
    executor: 'nx:run-commands',
    options: {
      commands: [
        cmd.rm(generatedSrcDirFromRoot),
        cmd.mkdir(generatedSrcDirFromRoot),
        cmd.cp(
          joinPathFragments('dist', modelProjectConfig.root, 'build', 'ssdk'),
          joinPathFragments(generatedSrcDirFromRoot, 'ssdk'),
        ),
      ],
      parallel: false,
    },
    outputs: ['{projectRoot}/src/generated'],
    dependsOn: [`${modelProjectConfig.name}:build`],
  };
  addDependencyToTargetIfNotPresent(
    backendProjectConfig,
    'compile',
    'copy-ssdk',
  );

  // Add a project which continuously copies based on changes to the model project
  // This allows the "serve" target to hot reload when the smithy model is changed
  backendProjectConfig.targets['watch-copy-ssdk'] = {
    executor: 'nx:run-commands',
    options: {
      command: `nx watch --projects=${modelProjectConfig.name} --includeDependentProjects -- nx run ${backendFullyQualifiedName}:copy-ssdk`,
    },
    continuous: true,
  };

  // Add serve target for running the server locally
  backendProjectConfig.targets.serve = {
    executor: 'nx:run-commands',
    options: {
      command: 'tsx --watch src/local-server.ts',
      cwd: '{projectRoot}',
    },
    continuous: true,
    dependsOn: ['copy-ssdk', 'watch-copy-ssdk'],
  };

  // Ignore generated code
  updateGitIgnore(tree, backendProjectConfig.root, (patterns) => [
    ...patterns,
    'src/generated',
  ]);
  addIgnoresToEslintConfig(
    tree,
    joinPathFragments(backendProjectConfig.root, 'eslint.config.mjs'),
    ['**/generated'],
  );

  updateProjectConfiguration(
    tree,
    backendFullyQualifiedName,
    backendProjectConfig,
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-smithy/server-apigateway',
      '@aws-smithy/server-node',
      '@middy/core',
      '@aws-lambda-powertools/logger',
      '@aws-lambda-powertools/tracer',
      '@aws-lambda-powertools/metrics',
    ]),
    withVersions(['@types/aws-lambda']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_SMITHY_API_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsSmithyApiGenerator;
