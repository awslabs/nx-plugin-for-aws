/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  GeneratorCallback,
  Tree,
  generateFiles,
  getProjects,
  installPackagesTask,
  joinPathFragments,
  readProjectConfiguration,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsDynamoDBGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  addGeneratorMetadata,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { addDynamoDBInfra } from '../../utils/dynamodb-constructs/dynamodb-constructs';
import { toClassName, kebabCase } from '../../utils/names';
import { toScopeAlias } from '../../utils/npm-scope';
import { getTsLibDetails } from '../lib/generator';
import tsProjectGenerator from '../lib/generator';

import { resolveIacProvider } from '../../utils/iac';
import { resolveContainerEngine } from '../../utils/containers';
import { getNpmScope } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { assignPort } from '../../utils/port';

export const TS_DYNAMODB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const DYNAMODB_LOCAL_IMAGE =
  'public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:latest';

export const tsDynamoDBGenerator = async (
  tree: Tree,
  options: TsDynamoDBGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = kebabCase(options.name);
  const nameClassName = toClassName(options.name);
  const localTableName = `${getNpmScope(tree)}-${kebabCase(options.tableName ?? options.name)}`;
  const iacProvider = await resolveIacProvider(tree, options.iacProvider);
  const containerEngine = await resolveContainerEngine(tree, 'Inherit');
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, {
    name: options.name,
    directory: options.directory,
    subDirectory: options.subDirectory,
  });

  await tsProjectGenerator(tree, {
    name: options.name,
    directory: options.directory,
  });

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);

  const existingDynamoPort = [...getProjects(tree).values()].find(
    (p) => (p.metadata as any)?.generator === TS_DYNAMODB_GENERATOR_INFO.id,
  )?.metadata as any;

  let localDynamoPort: number;
  if (existingDynamoPort?.ports?.[0] !== undefined) {
    localDynamoPort = existingDynamoPort.ports[0] as number;
    projectConfig.metadata ??= {};
    (projectConfig.metadata as any).ports = [
      ...((projectConfig.metadata as any).ports ?? []),
      localDynamoPort,
    ];
  } else {
    localDynamoPort = assignPort(tree, projectConfig, 8000);
  }

  const templateOptions = {
    runtimeConfigKey: nameClassName,
    dynamoPackageAlias: toScopeAlias(fullyQualifiedName),
    localDynamoPort,
    localTableName,
    containerEngine,
  };

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    dir,
    templateOptions,
  );
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'scripts', containerEngine),
    joinPathFragments(dir, 'scripts'),
    templateOptions,
  );
  tree.delete(joinPathFragments(dir, 'scripts', 'docker'));
  tree.delete(joinPathFragments(dir, 'scripts', 'finch'));

  const containerName = `${getNpmScope(tree)}-dynamodb`;

  projectConfig.targets['pull-image'] = {
    executor: 'nx:run-commands',
    options: {
      command: `tsx scripts/pull-image.ts ${DYNAMODB_LOCAL_IMAGE}`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets['serve-local'] = {
    executor: 'nx:run-commands',
    continuous: true,
    dependsOn: ['pull-image'],
    options: {
      commands: [
        `tsx scripts/start-container.ts ${containerName} ${DYNAMODB_LOCAL_IMAGE} ${localDynamoPort}`,
        `tsx scripts/create-local-table.ts ${localTableName} ${localDynamoPort}`,
      ],
      parallel: true,
      cwd: '{projectRoot}',
    },
  };

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);
  addGeneratorMetadata(tree, fullyQualifiedName, TS_DYNAMODB_GENERATOR_INFO);

  await sharedConstructsGenerator(tree, { iacProvider });
  await addDynamoDBInfra(tree, {
    iacProvider,
    projectName: fullyQualifiedName,
    nameClassName,
    nameKebabCase,
    dynamoPackageAlias: toScopeAlias(fullyQualifiedName),
    tableName: localTableName,
  });

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-sdk/client-dynamodb',
      'electrodb',
      '@aws-lambda-powertools/parameters',
    ]),
    withVersions(['tsx', '@types/aws-lambda']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_DYNAMODB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsDynamoDBGenerator;
