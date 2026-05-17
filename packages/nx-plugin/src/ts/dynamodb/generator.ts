/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  GeneratorCallback,
  Tree,
  generateFiles,
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
import { getNpmScope } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';

export const TS_DYNAMODB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const DYNAMODB_LOCAL_IMAGE =
  'public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:latest';
const DYNAMODB_LOCAL_START_PORT = 8000;

export const tsDynamoDBGenerator = async (
  tree: Tree,
  options: TsDynamoDBGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = kebabCase(options.name);
  const nameClassName = toClassName(options.name);
  const localTableName = `${getNpmScope(tree)}-${kebabCase(options.tableName ?? options.name)}`;
  const iacProvider = await resolveIacProvider(tree, options.iacProvider);
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

  const templateOptions = {
    runtimeConfigKey: nameClassName,
    dynamoPackageAlias: toScopeAlias(fullyQualifiedName),
    localDynamoPort: DYNAMODB_LOCAL_START_PORT,
    localTableName,
  };

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    dir,
    templateOptions,
  );

  const containerName = `${getNpmScope(tree)}-dynamodb`;

  projectConfig.targets['docker-pull'] = {
    executor: 'nx:run-commands',
    options: {
      command: `tsx scripts/docker-pull.ts ${DYNAMODB_LOCAL_IMAGE}`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets['serve-local'] = {
    executor: 'nx:run-commands',
    continuous: true,
    dependsOn: ['docker-pull'],
    options: {
      commands: [
        `tsx scripts/docker-start.ts ${containerName} ${DYNAMODB_LOCAL_IMAGE} ${DYNAMODB_LOCAL_START_PORT}`,
        `tsx scripts/create-local-table.ts ${localTableName} ${DYNAMODB_LOCAL_START_PORT}`,
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
    withVersions(['tsx', 'dockerode', '@types/dockerode', '@types/aws-lambda']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_DYNAMODB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsDynamoDBGenerator;
