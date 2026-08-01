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
import {
  addPyDependencies,
  addTsDependencies,
} from '../../utils/add-dependencies';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies';
import { addDockerScanTarget, DOCKER_DEPENDENCIES } from '../../utils/docker';
import { formatFilesInSubtree } from '../../utils/format';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs';
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
import { addRdbInfra } from '../../utils/rdb-constructs/rdb-constructs';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import {
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants';
import {
  SHARED_RDB_SCRIPTS_DEPENDENCIES,
  sharedRdbScriptsGenerator,
} from '../../utils/shared-rdb-scripts';
import { PY_VERSIONS } from '../../utils/versions';
import pyProjectGenerator, { getPyProjectDetails } from '../project/generator';
import type { PyRdbGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface PyRdbMetadata extends IacMetadata {
  readonly engine: PyRdbGeneratorSchema['engine'];
}

/** The Postgres engine, which MySQL takes none of. */
const isPostgres = (m: PyRdbMetadata) => m.engine !== 'mysql';

// Each entry names the engine branch it belongs to, so the same declaration
// drives both adding and the version sync.
export const DEPENDENCIES = declareDependencies<PyRdbMetadata>()({
  ts: [
    // The engine client the local dev script wait-for-*-db.ts imports.
    { name: 'mariadb', when: (m) => m.engine === 'mysql', root: true },
    { name: 'pg', when: isPostgres, root: true },
    { name: '@types/pg', when: isPostgres, dev: true, root: true },
    // Added by the helpers that own the projects they belong to.
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(SHARED_RDB_SCRIPTS_DEPENDENCIES),
  ],
  py: [
    { name: 'sqlmodel' },
    { name: 'alembic' },
    // SQLAlchemy's async engine (used by connection.py for both engines)
    // requires greenlet at runtime. Vend it explicitly at a pinned version so
    // the dependency graph is fully determined and doesn't float to an
    // unpublished-wheel release at install time.
    { name: 'greenlet' },
    { name: 'aiomysql', when: (m) => m.engine === 'mysql' },
    { name: 'asyncpg', when: (m) => m.engine !== 'mysql' },
    { name: 'boto3' },
    { name: 'aws-lambda-powertools' },
  ],
});

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
  // Recorded in the metadata below so the version sync can tell a CDK project
  // from a Terraform one; undefined when no infrastructure was generated.
  const iac =
    options.infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const metadata: PyRdbMetadata = { engine, ...(iac ? { iac } : {}) };
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

  await sharedRdbScriptsGenerator(tree, engine, DEPENDENCIES);
  const scriptsDir = relative(
    dir,
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'src', 'rdb'),
  );
  const fs = new FsCommands(tree, DEPENDENCIES);

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

      addDockerScanTarget(
        tree,
        {
          project: projectConfig,
          containerEngine,
          trivyTargetName: 'trivy',
          dockerTargetName: 'docker',
          imageTags: [migrationDockerImageTag, createDbUserDockerImageTag],
        },
        DEPENDENCIES,
      );
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
  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    PY_RDB_GENERATOR_INFO,
    metadata,
  );

  if (options.infra !== 'none') {
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);
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

  addPyDependencies(tree, DEPENDENCIES, { metadata, projectRoot: dir });
  addTsDependencies(tree, DEPENDENCIES, { metadata });

  await addGeneratorMetricsIfApplicable(tree, [PY_RDB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyRdbGenerator;
