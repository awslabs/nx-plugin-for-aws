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
import tsProjectGenerator, { getTsLibDetails } from '../../../ts/lib/generator';
import {
  API_CONSTRUCTS_DEPENDENCIES,
  addApiGatewayInfra,
} from '../../../utils/api-constructs/api-constructs';
import { addSharedConstructsOpenApiMetadataGenerateTarget } from '../../../utils/api-constructs/open-api-metadata';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../../utils/bundle/bundle';
import { declareDependencies } from '../../../utils/declared-dependencies';
import { addDependenciesToPackageJson } from '../../../utils/dependencies';
import { formatFilesInSubtree } from '../../../utils/format';
import { FS_DEPENDENCIES, FsCommands } from '../../../utils/fs';
import { updateGitIgnore } from '../../../utils/git';
import { resolveIac } from '../../../utils/iac';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { esmVars } from '../../../utils/module-format';
import { toClassName, toKebabCase } from '../../../utils/names';
import {
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  normalizeTargetKeyOrder,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { assignPort } from '../../../utils/port';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs';
import { withVersions } from '../../../utils/versions';
import smithyProjectGenerator from '../../project/generator';
import type { TsSmithyApiGeneratorSchema } from './schema';

export const DECLARED_DEPENDENCIES = declareDependencies({
  ts: [
    '@aws-smithy/server-apigateway',
    '@aws-smithy/server-node',
    '@middy/core',
    '@aws-lambda-powertools/logger',
    '@aws-lambda-powertools/parameters',
    '@aws-lambda-powertools/tracer',
    '@aws-lambda-powertools/metrics',
    '@aws-sdk/client-appconfigdata',
    '@aws-lambda-powertools/parser',
    '@types/aws-lambda',
    'tsx',
    ...FS_DEPENDENCIES,
    ...API_CONSTRUCTS_DEPENDENCIES,
    ...BUNDLE_DEPENDENCIES,
    ...SHARED_CONSTRUCTS_DEPENDENCIES,
  ],
});

export const TS_SMITHY_API_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const tsSmithyApiGenerator = async (
  tree: Tree,
  options: TsSmithyApiGeneratorSchema,
): Promise<GeneratorCallback> => {
  if (
    (options.infra as string) !== 'rest-lambda' &&
    (options.infra as string) !== 'none'
  ) {
    throw new Error(
      `Unsupported infra '${options.infra}' for Smithy TypeScript API. ` +
        `Only 'rest-lambda' (API Gateway REST API) is supported.`,
    );
  }

  const integrationPattern = getIntegrationPattern(options);
  const apiNameClassName = toClassName(options.name);
  const apiNameKebabCase = toKebabCase(options.name);
  const { fullyQualifiedName: backendFullyQualifiedName, dir } =
    getTsLibDetails(tree, options);
  const modelProjectName = `${apiNameKebabCase}-model`;

  let projectExists: boolean;
  try {
    readProjectConfigurationUnqualified(tree, backendFullyQualifiedName);
    projectExists = true;
  } catch {
    projectExists = false;
  }

  if (!projectExists) {
    // Generate the model project
    await smithyProjectGenerator(tree, {
      name: modelProjectName,
      serviceName: apiNameClassName,
      namespace: options.namespace,
      directory: dir,
      subDirectory: 'model',
      preferInstallDependencies: false,
    });

    // Generate the backend project
    await tsProjectGenerator(tree, {
      name: options.name,
      directory: dir,
      subDirectory: 'backend',
      preferInstallDependencies: false,
    });
  }

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
    joinPathFragments(import.meta.dirname, 'files'),
    backendProjectConfig.sourceRoot,
    {
      apiNameClassName,
      port,
      ...esmVars(tree),
    },
  );

  if (options.infra !== 'none') {
    if (options.auth === 'custom') {
      generateFiles(
        tree,
        joinPathFragments(
          import.meta.dirname,
          '..',
          '..',
          '..',
          'utils',
          'api-constructs',
          'files',
          'cdk',
          'authorizer',
          'rest',
        ),
        backendProjectConfig.sourceRoot,
        {},
        {
          overwriteStrategy: OverwriteStrategy.KeepExisting,
        },
      );
    }

    // Add infrastructure
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(
      tree,
      {
        iac,
      },
      DECLARED_DEPENDENCIES,
    );
    await addApiGatewayInfra(
      tree,
      {
        iac,
        apiProjectName: backendFullyQualifiedName,
        apiNameClassName,
        apiNameKebabCase,
        auth: options.auth,
        constructType: 'rest',
        backend: {
          type: 'smithy',
          bundleOutputDir: joinPathFragments(
            'dist',
            backendProjectConfig.root,
            'bundle',
          ),
          integrationPattern,
          ...(options.auth === 'custom' && {
            authorizerBundleOutputDir: joinPathFragments(
              'dist',
              backendProjectConfig.root,
              'bundle',
              'authorizer',
            ),
          }),
        },
      },
      DECLARED_DEPENDENCIES,
    );
    addSharedConstructsOpenApiMetadataGenerateTarget(tree, {
      iac,
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
    await addTypeScriptBundleTarget(
      tree,
      backendProjectConfig,
      {
        targetFilePath: 'src/handler.ts',
        external: [/@aws-sdk\/.*/], // lambda runtime provides aws sdk
      },
      DECLARED_DEPENDENCIES,
    );

    if (options.auth === 'custom') {
      await addTypeScriptBundleTarget(
        tree,
        backendProjectConfig,
        {
          targetFilePath: 'src/authorizer.ts',
          bundleOutputDir: 'authorizer',
          external: [/@aws-sdk\/.*/],
        },
        DECLARED_DEPENDENCIES,
      );
    }
  }

  const cmd = new FsCommands(tree, DECLARED_DEPENDENCIES);
  const generatedSrcDirFromRoot = '{projectRoot}/src/generated';

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
    continuous: true,
    options: {
      command: `nx watch --projects=${modelProjectConfig.name} --includeDependencies -- nx run ${backendFullyQualifiedName}:copy-ssdk`,
    },
  };

  // Add serve target for running the server locally
  backendProjectConfig.targets.serve = normalizeTargetKeyOrder({
    executor: 'nx:run-commands',
    continuous: true,
    dependsOn: ['copy-ssdk', 'watch-copy-ssdk'],
    options: {
      command: 'tsx --watch src/local-server.ts',
      cwd: '{projectRoot}',
    },
  });

  const existingDevDependsOn =
    backendProjectConfig.targets['dev']?.dependsOn ?? [];

  backendProjectConfig.targets['dev'] = normalizeTargetKeyOrder({
    ...backendProjectConfig.targets.serve,
    // Own copy of dependsOn so adding dev dependencies below doesn't
    // mutate the shared array referenced by the serve target.
    dependsOn: [...(backendProjectConfig.targets.serve.dependsOn ?? [])],
    options: {
      ...backendProjectConfig.targets.serve.options,
      env: {
        LOCAL_DEV: 'true',
      },
    },
  });

  // Preserve any dependencies added to dev by connection generators
  for (const dependency of existingDevDependsOn) {
    addDependencyToTargetIfNotPresent(backendProjectConfig, 'dev', dependency);
  }

  // Ignore generated code
  updateGitIgnore(tree, backendProjectConfig.root, (patterns) => [
    ...patterns,
    'src/generated',
  ]);

  updateProjectConfiguration(
    tree,
    backendFullyQualifiedName,
    backendProjectConfig,
  );

  addDependenciesToPackageJson(
    tree,
    withVersions(DECLARED_DEPENDENCIES, [
      '@aws-smithy/server-apigateway',
      '@aws-smithy/server-node',
      '@middy/core',
      '@aws-lambda-powertools/logger',
      '@aws-lambda-powertools/parameters',
      '@aws-lambda-powertools/tracer',
      '@aws-lambda-powertools/metrics',
      '@aws-sdk/client-appconfigdata',
      ...(options.auth === 'custom'
        ? (['@aws-lambda-powertools/parser'] as const)
        : []),
    ]),
    withVersions(DECLARED_DEPENDENCIES, ['@types/aws-lambda']),
    joinPathFragments(backendProjectConfig.root, 'package.json'),
  );
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(DECLARED_DEPENDENCIES, ['tsx']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_SMITHY_API_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

const getIntegrationPattern = (
  options: TsSmithyApiGeneratorSchema,
): 'isolated' | 'shared' => options.integrationPattern ?? 'isolated';

export default tsSmithyApiGenerator;
