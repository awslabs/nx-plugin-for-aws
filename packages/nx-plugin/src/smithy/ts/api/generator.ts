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
import tsProjectGenerator, {
  getTsLibDetails,
} from '../../../ts/lib/generator.js';
import { addTsDependencies } from '../../../utils/add-dependencies.js';
import {
  API_CONSTRUCTS_DEPENDENCIES,
  API_CONSTRUCTS_PY_DEPENDENCIES,
  addApiGatewayInfra,
} from '../../../utils/api-constructs/api-constructs.js';
import { addSharedConstructsOpenApiMetadataGenerateTarget } from '../../../utils/api-constructs/open-api-metadata.js';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../../utils/bundle/bundle.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { FS_DEPENDENCIES, FsCommands } from '../../../utils/fs.js';
import { updateGitIgnore } from '../../../utils/git.js';
import { resolveIac } from '../../../utils/iac.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { esmVars } from '../../../utils/module-format.js';
import { toClassName, toKebabCase } from '../../../utils/names.js';
import {
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  normalizeTargetKeyOrder,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { assignPort } from '../../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import type { IacMetadata } from '../../../utils/shared-constructs-constants.js';
import smithyProjectGenerator from '../../project/generator.js';
import type { TsSmithyApiGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TsSmithyApiMetadata extends IacMetadata {
  readonly apiName: string;
  readonly auth: TsSmithyApiGeneratorSchema['auth'];
  readonly modelProject: string;
}

// Each entry names the branch it belongs to, so the same declaration drives both
// adding and the version sync.
export const DEPENDENCIES = declareDependencies<TsSmithyApiMetadata>()({
  ts: [
    { name: '@smithy/server-apigateway' },
    { name: '@smithy/server-node' },
    { name: '@middy/core' },
    { name: '@aws-lambda-powertools/logger' },
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@aws-lambda-powertools/tracer' },
    { name: '@aws-lambda-powertools/metrics' },
    { name: '@aws-sdk/client-appconfigdata' },
    // The custom authorizer handler parses its event.
    { name: '@aws-lambda-powertools/parser', when: (m) => m.auth === 'custom' },
    { name: '@types/aws-lambda', dev: true },
    // tsx runs the local server from the workspace root.
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(API_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(BUNDLE_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: ownedElsewhere(API_CONSTRUCTS_PY_DEPENDENCIES),
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

  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    options.infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

  // Recorded here and read by the declaration's predicates, so the packages
  // added below are exactly the ones the version sync will own.
  const metadata: TsSmithyApiMetadata = {
    apiName: options.name,
    auth: options.auth,
    modelProject: modelProjectConfig.name,
    ...(iac ? { iac } : {}),
  };

  addGeneratorMetadata(
    tree,
    backendFullyQualifiedName,
    TS_SMITHY_API_GENERATOR_INFO,
    metadata,
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
    await sharedConstructsGenerator(
      tree,
      {
        iac,
      },
      DEPENDENCIES,
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
      DEPENDENCIES,
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
      integrationPattern,
    });

    // Add bundle target using rolldown
    await addTypeScriptBundleTarget(
      tree,
      backendProjectConfig,
      {
        targetFilePath: 'src/handler.ts',
        external: [/@aws-sdk\/.*/], // lambda runtime provides aws sdk
      },
      DEPENDENCIES,
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
        DEPENDENCIES,
      );
    }
  }

  const cmd = new FsCommands(tree, DEPENDENCIES);
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
        cmd.cpDir(
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

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: backendProjectConfig.root,
  });

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
