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

import { resolveIac } from '../../utils/iac';
import { resolveContainers } from '../../utils/containers';
import { getNpmScope } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { assignSharedPort } from '../../utils/port';

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
  const containerEngine = await resolveContainers(tree, 'inherit');
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, {
    name: options.name,
    directory: options.directory,
    subDirectory: options.subDirectory,
  });

  let projectExists: boolean;
  try {
    readProjectConfiguration(tree, fullyQualifiedName);
    projectExists = true;
  } catch {
    projectExists = false;
  }

  if (!projectExists) {
    await tsProjectGenerator(tree, {
      name: options.name,
      directory: options.directory,
    });
  }

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);

  const localDynamoPort = assignSharedPort(
    tree,
    projectConfig,
    TS_DYNAMODB_GENERATOR_INFO.id,
    8000,
  );

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

  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(tree, { iac });
    await addDynamoDBInfra(tree, {
      iac,
      projectName: fullyQualifiedName,
      nameClassName,
      nameKebabCase,
      dynamoPackageAlias: toScopeAlias(fullyQualifiedName),
      tableName: localTableName,
    });
  }

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
