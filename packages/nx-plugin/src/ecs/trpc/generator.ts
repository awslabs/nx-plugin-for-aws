/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsEcsTrpcApiGeneratorSchema } from './schema';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import tsProjectGenerator from '../../ts/lib/generator';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { kebabCase, toClassName } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
import { sortObjectKeys } from '../../utils/object';
import {
  NxGeneratorInfo,
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { assignPort } from '../../utils/port';
import { resolveIacProvider } from '../../utils/iac';
import { addEcsInfra } from '../../utils/ecs-constructs/ecs-constructs';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';

export const ECS_TRPC_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsEcsTrpcApiGenerator(
  tree: Tree,
  options: TsEcsTrpcApiGeneratorSchema,
) {
  const iacProvider = await resolveIacProvider(tree, options.iacProvider);

  await sharedConstructsGenerator(tree, { iacProvider });

  const apiNamespace = getNpmScopePrefix(tree);
  const apiNameKebabCase = kebabCase(options.name);
  const apiNameClassName = toClassName(options.name);

  const backendName = apiNameKebabCase;
  const backendProjectName = `${apiNamespace}${backendName}`;

  await tsProjectGenerator(tree, {
    name: backendName,
    directory: options.directory,
  });

  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    backendProjectName,
  );
  const backendRoot = projectConfig.root;

  const port = assignPort(tree, projectConfig, 3000);

  const enhancedOptions = {
    backendProjectName,
    backendProjectAlias: toScopeAlias(backendProjectName),
    apiNameKebabCase,
    apiNameClassName,
    backendRoot,
    port,
    ...options,
  };

  addEcsInfra(tree, {
    apiProjectName: backendProjectName,
    apiNameClassName,
    apiNameKebabCase,
    backendProjectAlias: enhancedOptions.backendProjectAlias,
    backendRoot,
    port,
    auth: options.auth,
    iacProvider,
  });

  projectConfig.metadata = {
    ...projectConfig.metadata,
    apiName: options.name,
    apiType: 'ecs-trpc',
    auth: options.auth,
    port,
  } as unknown;

  projectConfig.targets.serve = {
    executor: 'nx:run-commands',
    options: {
      commands: ['tsx --watch src/local-server.ts'],
      cwd: '{projectRoot}',
    },
    continuous: true,
  };

  addTypeScriptBundleTarget(tree, projectConfig, {
    targetFilePath: 'src/server.ts',
  });

  addDependencyToTargetIfNotPresent(projectConfig, 'build', 'bundle');

  projectConfig.targets = sortObjectKeys(projectConfig.targets);

  updateProjectConfiguration(tree, projectConfig.name, projectConfig);

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    backendRoot,
    enhancedOptions,
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  // Generate shared tRPC template files (router, procedures, schema)
  generateFiles(
    tree,
    joinPathFragments(__dirname, '../../utils/files/trpc'),
    backendRoot,
    enhancedOptions,
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  tree.delete(joinPathFragments(backendRoot, 'src', 'lib'));

  addDependenciesToPackageJson(
    tree,
    withVersions(['zod', '@trpc/server', '@trpc/client', 'fastify']),
    withVersions(['tsx']),
  );
  tree.delete(joinPathFragments(backendRoot, 'package.json'));

  addGeneratorMetadata(tree, backendName, ECS_TRPC_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [ECS_TRPC_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}

export default tsEcsTrpcApiGenerator;
