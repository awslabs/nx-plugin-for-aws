/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { relative } from 'node:path';
import {
  addDependenciesToPackageJson,
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { resolveContainers } from '../../utils/containers';
import { addDynamoDBInfra } from '../../utils/dynamodb-constructs/dynamodb-constructs';
import { formatFilesInSubtree } from '../../utils/format';
import { resolveIac } from '../../utils/iac';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addDevAlias,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../utils/nx';
import { assignSharedPort } from '../../utils/port';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  DYNAMODB_GENERATOR_IDS,
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants';
import { sharedDynamoDBScriptsGenerator } from '../../utils/shared-dynamodb-scripts';
import { withVersions } from '../../utils/versions';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import type { TsDynamoDBGeneratorSchema } from './schema';

export const TS_DYNAMODB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

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

  const localDynamoDBPort = assignSharedPort(
    tree,
    projectConfig,
    DYNAMODB_GENERATOR_IDS,
    8000,
  );

  const containerName = `${getNpmScope(tree)}-dynamodb`;

  const templateOptions = {
    runtimeConfigKey: nameClassName,
    localDynamoDBPort,
    localTableName,
    containerName,
    containerEngine,
  };

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    dir,
    templateOptions,
  );

  await sharedDynamoDBScriptsGenerator(tree);

  const scriptsDir = relative(
    dir,
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'src', 'dynamodb'),
  );

  projectConfig.targets['pull-image'] = {
    executor: 'nx:run-commands',
    options: {
      command: `tsx ${scriptsDir}/pull-image.ts`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets['serve-local'] = {
    executor: 'nx:run-commands',
    continuous: true,
    options: {
      commands: [
        `tsx ${scriptsDir}/start-container.ts`,
        `tsx ${scriptsDir}/create-local-table.ts`,
      ],
      parallel: true,
      cwd: '{projectRoot}',
    },
  };
  addDevAlias(projectConfig.targets, 'serve-local');

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
      tableName: localTableName,
      projectRoot: dir,
    });
  }

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-sdk/client-dynamodb',
      'electrodb',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
    ]),
    withVersions(['tsx', '@types/aws-lambda', '@types/node']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_DYNAMODB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsDynamoDBGenerator;
