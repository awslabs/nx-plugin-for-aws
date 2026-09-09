/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { relative } from 'node:path';
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addPyDependencies } from '../../utils/add-dependencies.js';
import { addPythonReExport } from '../../utils/agent-connection/agent-connection.js';
import { resolveContainers } from '../../utils/containers.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import {
  DYNAMODB_LOCAL_IMAGE,
  writeDynamoDBConfig,
} from '../../utils/dynamodb-config.js';
import { addDynamoDBInfra } from '../../utils/dynamodb-constructs/dynamodb-constructs.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { kebabCase, toClassName } from '../../utils/names.js';
import { getNpmScope } from '../../utils/npm-scope.js';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx.js';
import { assignSharedPort } from '../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  DYNAMODB_GENERATOR_IDS,
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants.js';
import {
  SHARED_DYNAMODB_SCRIPTS_DEPENDENCIES,
  sharedDynamoDBScriptsGenerator,
} from '../../utils/shared-dynamodb-scripts.js';
import pyProjectGenerator, {
  getPyProjectDetails,
} from '../project/generator.js';
import type { PyDynamoDBGeneratorSchema } from './schema';

export const DEPENDENCIES = declareDependencies()({
  ts: [
    ...ownedElsewhere(SHARED_DYNAMODB_SCRIPTS_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: [
    { name: 'pynamodb' },
    { name: 'boto3' },
    { name: 'aws-lambda-powertools' },
  ],
});

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
  };

  // The entities and the client are the user's to author — the guide walks
  // through adding entity modules under `entities/` — so a re-run leaves them
  // alone.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    dir,
    templateOptions,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // The barrels re-export the generated base and example models. Adding to
  // whatever is already there registers them without discarding the user's own
  // entity exports on a re-run — which matters beyond the barrel itself, since
  // PynamoDB only registers a model's discriminator once it is imported.
  const entitiesInitPath = joinPathFragments(
    dir,
    normalizedModuleName,
    'entities',
    '__init__.py',
  );
  await addPythonReExport(tree, entitiesInitPath, '.base', 'BaseModel');
  await addPythonReExport(tree, entitiesInitPath, '.example', 'ExampleModel');

  const packageInitPath = joinPathFragments(
    dir,
    normalizedModuleName,
    '__init__.py',
  );
  for (const importName of ['BaseModel', 'ExampleModel']) {
    await addPythonReExport(tree, packageInitPath, '.entities', importName);
  }

  writeDynamoDBConfig(tree, dir, {
    runtimeConfigKey: nameClassName,
    localDev: {
      port: localDynamoDBPort,
      tableName: localTableName,
      image: DYNAMODB_LOCAL_IMAGE,
      containerName,
      containerEngine,
    },
  });

  await sharedDynamoDBScriptsGenerator(tree, DEPENDENCIES);

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
  // Recorded so the version sync can tell a CDK project from a Terraform one;
  // undefined when no infrastructure was generated.
  const iac =
    options.infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    PY_DYNAMODB_GENERATOR_INFO,
    iac ? { iac } : {},
  );

  if (options.infra !== 'none') {
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);
    await addDynamoDBInfra(tree, {
      iac,
      projectName: fullyQualifiedName,
      nameClassName,
      nameKebabCase: kebabCase(options.name),
      tableName: localTableName,
      projectRoot: dir,
    });
  }

  addPyDependencies(tree, DEPENDENCIES, { projectRoot: dir });

  await addGeneratorMetricsIfApplicable(tree, [PY_DYNAMODB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyDynamoDBGenerator;
