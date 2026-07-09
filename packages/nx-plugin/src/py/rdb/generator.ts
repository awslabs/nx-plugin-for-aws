/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { relative } from 'node:path';
import {
  addDependenciesToPackageJson,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, snakeCase, toClassName } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
} from '../../utils/nx';
import { assignPort } from '../../utils/port';
import { addDependenciesToPyProjectToml } from '../../utils/py';
import { addRdbInfra } from '../../utils/rdb-constructs/rdb-constructs';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants';
import { sharedRdbScriptsGenerator } from '../../utils/shared-rdb-scripts';
import { PY_VERSIONS, withVersions } from '../../utils/versions';
import pyProjectGenerator, { getPyProjectDetails } from '../project/generator';
import type { PyRdbGeneratorSchema } from './schema';

export const PY_RDB_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const pyRdbGenerator = async (
  tree: Tree,
  options: PyRdbGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameClassName = toClassName(options.name);
  const databaseUser = options.databaseUser ?? 'dbadmin';
  const databaseName = snakeCase(options.databaseName ?? options.name);
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
    });
  }

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);

  const { engine } = options;
  const localDbPort = assignPort(
    tree,
    projectConfig,
    engine === 'mysql' ? 3306 : 5432,
  );
  const localDbHost = 'localhost';
  const localDbUser = engine === 'mysql' ? 'root' : 'dbadmin';
  const localDbPassword = 'password';
  const containerName = `${getNpmScope(tree)}-${databaseName}`;
  const dockerImage =
    engine === 'mysql'
      ? 'public.ecr.aws/docker/library/mysql:8.0.44'
      : 'public.ecr.aws/docker/library/postgres:17.7';

  const templateOptions = {
    name: normalizedModuleName,
    runtimeConfigKey: nameClassName,
    engine,
    localDbPort,
    localDbHost,
    localDbName: databaseName,
    localDbUser,
    localDbPassword,
    containerEngine,
    containerName,
    dockerImage,
    sqlmodelVersion: PY_VERSIONS.sqlmodel,
    alembicVersion: PY_VERSIONS.alembic,
    aiomysqlVersion: PY_VERSIONS.aiomysql,
    asyncpgVersion: PY_VERSIONS.asyncpg,
    boto3Version: PY_VERSIONS.boto3,
    awsLambdaPowertoolsVersion: PY_VERSIONS['aws-lambda-powertools'],
  };

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    dir,
    templateOptions,
  );

  await sharedRdbScriptsGenerator(tree, engine);
  // Used by local dev script wait-for-*-db.ts
  addDependenciesToPackageJson(
    tree,
    withVersions([engine === 'mysql' ? 'mariadb' : 'pg']),
    engine === 'mysql' ? {} : withVersions(['@types/pg']),
  );
  const scriptsDir = relative(
    dir,
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'src', 'rdb'),
  );
  const fs = new FsCommands(tree);

  const migrationBundleDir = joinPathFragments(
    'dist',
    projectConfig.root,
    'docker',
    'migration',
  );
  const createDbUserBundleDir = joinPathFragments(
    'dist',
    projectConfig.root,
    'docker',
    'create-db-user',
  );
  const migrationDockerImageTag = `${getNpmScope(tree)}-${kebabCase(options.name)}-migration:latest`;
  const createDbUserDockerImageTag = `${getNpmScope(tree)}-${kebabCase(
    options.name,
  )}-create-db-user:latest`;

  if (options.infra !== 'none') {
    const { bundleTargetName, bundleOutputDir } = addPythonBundleTarget(
      projectConfig,
      { pythonPlatform: 'aarch64-manylinux_2_28' },
    );

    projectConfig.targets['bundle-migration'] = {
      cache: true,
      outputs: ['{workspaceRoot}/dist/{projectRoot}/docker/migration'],
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.rm(migrationBundleDir),
          fs.mkdir(migrationBundleDir),
          fs.cp(bundleOutputDir, migrationBundleDir),
          fs.cp(
            joinPathFragments(dir, 'migrations'),
            joinPathFragments(migrationBundleDir, 'migrations'),
          ),
          fs.cp(
            joinPathFragments(dir, 'alembic.ini'),
            joinPathFragments(migrationBundleDir, 'alembic.ini'),
          ),
          fs.cp(
            joinPathFragments(dir, 'Dockerfile.migration'),
            joinPathFragments(migrationBundleDir, 'Dockerfile'),
          ),
        ],
        parallel: false,
      },
      dependsOn: [bundleTargetName],
    };
    projectConfig.targets['bundle-create-db-user'] = {
      cache: true,
      outputs: ['{workspaceRoot}/dist/{projectRoot}/docker/create-db-user'],
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.rm(createDbUserBundleDir),
          fs.mkdir(createDbUserBundleDir),
          fs.cp(bundleOutputDir, createDbUserBundleDir),
          fs.cp(
            joinPathFragments(dir, 'Dockerfile.create-db-user'),
            joinPathFragments(createDbUserBundleDir, 'Dockerfile'),
          ),
        ],
        parallel: false,
      },
      dependsOn: [bundleTargetName],
    };
    addDependencyToTargetIfNotPresent(
      projectConfig,
      'bundle',
      'bundle-migration',
    );
    addDependencyToTargetIfNotPresent(
      projectConfig,
      'bundle',
      'bundle-create-db-user',
    );
  }

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
    options: {
      command: `tsx ${scriptsDir}/start-container.ts`,
      cwd: '{projectRoot}',
    },
    dependsOn: ['pull-image'],
  };
  projectConfig.targets['wait-for-db'] = {
    executor: 'nx:run-commands',
    dependsOn: ['dev'],
    options: {
      command: `tsx ${scriptsDir}/wait-for-${engine}-db.ts`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets.migrate = {
    executor: 'nx:run-commands',
    dependsOn: ['dev', 'wait-for-db'],
    options: {
      command: 'uv run alembic upgrade head',
      cwd: '{projectRoot}',
      env: {
        LOCAL_DEV: 'true',
      },
    },
  };
  projectConfig.targets.alembic = {
    executor: 'nx:run-commands',
    dependsOn: ['dev', 'wait-for-db'],
    options: {
      command: 'uv run alembic',
      cwd: '{projectRoot}',
      env: {
        LOCAL_DEV: 'true',
      },
    },
  };

  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);
    if (iac === 'terraform') {
      projectConfig.targets.docker = {
        cache: true,
        executor: 'nx:run-commands',
        options: {
          commands: [
            `${containerEngine} build --platform linux/arm64 --provenance=false -t ${migrationDockerImageTag} ${migrationBundleDir}`,
            `${containerEngine} build --platform linux/arm64 --provenance=false -t ${createDbUserDockerImageTag} ${createDbUserBundleDir}`,
          ],
          parallel: false,
        },
        dependsOn: ['bundle-migration', 'bundle-create-db-user'],
      };
      addDependencyToTargetIfNotPresent(projectConfig, 'build', 'docker');
    }
    addDependencyToTargetIfNotPresent(
      projectConfig,
      'build',
      'bundle-migration',
    );
    addDependencyToTargetIfNotPresent(
      projectConfig,
      'build',
      'bundle-create-db-user',
    );
  }

  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);
  addGeneratorMetadata(tree, fullyQualifiedName, PY_RDB_GENERATOR_INFO, {
    engine,
  });

  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(tree, { iac });
    await addRdbInfra(tree, {
      iac,
      projectName: fullyQualifiedName,
      projectRoot: dir,
      nameClassName,
      nameKebabCase: kebabCase(options.name),
      databasePackageAlias: normalizedModuleName,
      databaseName,
      adminUser: databaseUser,
      engine,
      migrationBundleDir,
      createDbUserBundleDir,
      framework: 'sqlmodel',
      createDbUserDockerImageTag,
      migrationDockerImageTag,
      containerEngine,
    });
  }

  addDependenciesToPyProjectToml(tree, dir, [
    'sqlmodel',
    'alembic',
    ...(engine === 'mysql'
      ? (['aiomysql', 'boto3', 'aws-lambda-powertools'] as const)
      : (['asyncpg', 'boto3', 'aws-lambda-powertools'] as const)),
  ]);

  await addGeneratorMetricsIfApplicable(tree, [PY_RDB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyRdbGenerator;
