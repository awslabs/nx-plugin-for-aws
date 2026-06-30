/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { relative } from 'node:path';
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { resolveContainers } from '../../utils/containers';
import { addDynamoDBInfra } from '../../utils/dynamodb-constructs/dynamodb-constructs';
import { formatFilesInSubtree } from '../../utils/format';
import { resolveIac } from '../../utils/iac';
import { installDeps } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import { assignSharedPort } from '../../utils/port';
import { addDependenciesToPyProjectToml } from '../../utils/py';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  DYNAMODB_GENERATOR_IDS,
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants';
import { sharedDynamoDBScriptsGenerator } from '../../utils/shared-dynamodb-scripts';
import pyProjectGenerator, { getPyProjectDetails } from '../project/generator';
import type { PyDynamoDBGeneratorSchema } from './schema';

export const PY_DYNAMODB_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const pyDynamoDBGenerator = async (
  tree: Tree,
  options: PyDynamoDBGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameClassName = toClassName(options.name);
  const localTableName = `${getNpmScope(tree)}-${kebabCase(options.tableName ?? options.name)}`;
  const containerEngine = await resolveContainers(tree, 'inherit');
  const { fullyQualifiedName, dir, normalizedModuleName } = getPyProjectDetails(
    tree,
    {
      name: options.name,
      directory: options.directory,
      subDirectory: options.subDirectory,
    },
  );

  if (!projectExists(tree, fullyQualifiedName)) {
    await pyProjectGenerator(tree, {
      name: options.name,
      directory: options.directory,
      subDirectory: options.subDirectory,
      type: 'library',
      preferInstallDependencies: false,
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
    name: normalizedModuleName,
    runtimeConfigKey: nameClassName,
    localDynamoDBPort,
    localTableName,
    containerName,
    containerEngine,
  };

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
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
  projectConfig.targets['dev'] = {
    executor: 'nx:run-commands',
    continuous: true,
    dependsOn: ['pull-image'],
    options: {
      commands: [
        `tsx ${scriptsDir}/start-container.ts`,
        `tsx ${scriptsDir}/create-local-table.ts`,
      ],
      parallel: true,
      cwd: '{projectRoot}',
    },
  };

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);
  addGeneratorMetadata(tree, fullyQualifiedName, PY_DYNAMODB_GENERATOR_INFO);

  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(tree, { iac });
    await addDynamoDBInfra(tree, {
      iac,
      projectName: fullyQualifiedName,
      nameClassName,
      nameKebabCase: kebabCase(options.name),
      tableName: localTableName,
      projectRoot: dir,
    });
  }

  addDependenciesToPyProjectToml(tree, dir, [
    'pynamodb',
    'boto3',
    'aws-lambda-powertools',
  ]);

  await addGeneratorMetricsIfApplicable(tree, [PY_DYNAMODB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => installDeps(tree, options.preferInstallDependencies, {
    languages: ['typescript', 'python'],
  });
};

export default pyDynamoDBGenerator;
