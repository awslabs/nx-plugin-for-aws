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
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
import { updateGitIgnore } from '../../utils/git';
import { resolveIac } from '../../utils/iac';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, snakeCase, toClassName } from '../../utils/names';
import { getNpmScope, toScopeAlias } from '../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../utils/nx';
import { getRelativePathToRootByDirectory } from '../../utils/paths';
import { registerPnpmBuiltDependencies } from '../../utils/pnpm-workspace';
import { assignPort } from '../../utils/port';
import { addRdbInfra } from '../../utils/rdb-constructs/rdb-constructs';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../utils/shared-constructs-constants';
import { sharedRdbScriptsGenerator } from '../../utils/shared-rdb-scripts';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import type { TsRdbGeneratorSchema } from './schema';

export const TS_RDB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbGenerator = async (
  tree: Tree,
  options: TsRdbGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = kebabCase(options.name);
  const nameClassName = toClassName(options.name);
  const databaseUser = options.databaseUser ?? 'dbadmin';
  const databaseName = snakeCase(options.databaseName ?? options.name);
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

  updateJson(tree, joinPathFragments(dir, 'tsconfig.lib.json'), (tsConfig) => ({
    ...tsConfig,
    include: ['src/**/*.ts', 'generated/prisma/**/*.ts'],
  }));

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const localDbPort = assignPort(
    tree,
    projectConfig,
    options.engine === 'mysql' ? 3306 : 5432,
  );
  const localDbHost = 'localhost';
  const localDbUser = options.engine === 'mysql' ? 'root' : 'dbadmin';
  const localDbPassword = 'password';
  const containerName = `${getNpmScope(tree)}-${databaseName}`;
  const dockerImage =
    options.engine === 'mysql'
      ? 'public.ecr.aws/docker/library/mysql:8.0.44'
      : 'public.ecr.aws/docker/library/postgres:17.7';

  const templateOptions = {
    engine: options.engine,
    runtimeConfigKey: nameClassName,
    databasePackageAlias: toScopeAlias(fullyQualifiedName),
    databaseProvider: options.engine === 'mysql' ? 'mysql' : 'postgresql',
    prismaVersion: TS_VERSIONS.prisma,
    prismaAdapterPackage:
      options.engine === 'mysql'
        ? '@prisma/adapter-mariadb'
        : '@prisma/adapter-pg',
    prismaAdapterClassName:
      options.engine === 'mysql' ? 'PrismaMariaDb' : 'PrismaPg',
    localDbPort,
    localDbHost,
    localDbName: databaseName,
    localDbUser,
    localDbPassword,
    containerEngine,
    containerName,
    dockerImage,
  };

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    dir,
    templateOptions,
  );
  updateGitIgnore(tree, dir, (patterns) => [...patterns, 'generated/prisma']);
  await sharedRdbScriptsGenerator(
    tree,
    options.engine === 'mysql' ? 'mysql' : 'postgres',
  );
  const waitForDbScript =
    options.engine === 'mysql'
      ? 'wait-for-mysql-db.ts'
      : 'wait-for-postgres-db.ts';
  const scriptsDir = relative(
    dir,
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'src', 'rdb'),
  );
  const relativePathToRoot = getRelativePathToRootByDirectory(
    projectConfig.root,
  );
  const fs = new FsCommands(tree);
  const migrationBundleDir = joinPathFragments(
    'dist',
    projectConfig.root,
    'bundle',
    'migration',
  );
  const dockerImageTag = `${getNpmScope(tree)}-${kebabCase(options.name)}-migration:latest`;

  if (options.infra !== 'none') {
    await addTypeScriptBundleTarget(tree, projectConfig, {
      targetFilePath: 'src/migration-handler.ts',
      bundleOutputDir: 'migration',
    });
    await addTypeScriptBundleTarget(tree, projectConfig, {
      targetFilePath: 'src/create-db-user-handler.ts',
      bundleOutputDir: 'create-db-user',
    });
    const bundleTarget = projectConfig.targets['bundle'];
    // The bundle target starts with a single rolldown `command`. Wrap it with
    // the migration asset copy steps, unless it has already been transformed
    // into a `commands` array on a previous run.
    if (!bundleTarget.options.commands) {
      const rolldownCommand = bundleTarget.options.command;
      delete bundleTarget.options.command;
      bundleTarget.options = {
        ...bundleTarget.options,
        commands: [
          fs.rm(`${relativePathToRoot}dist/{projectRoot}/bundle/migration`),
          fs.mkdir(`${relativePathToRoot}dist/{projectRoot}/bundle/migration`),
          fs.cp(
            'prisma',
            `${relativePathToRoot}dist/{projectRoot}/bundle/migration/prisma`,
          ),
          fs.cp(
            'prisma.config.ts',
            `${relativePathToRoot}dist/{projectRoot}/bundle/migration/prisma.config.ts`,
          ),
          fs.cp(
            'Dockerfile',
            `${relativePathToRoot}dist/{projectRoot}/bundle/migration/Dockerfile`,
          ),
          rolldownCommand,
        ],
        parallel: false,
      };
    }
  }

  projectConfig.targets.generate = {
    executor: 'nx:run-commands',
    outputs: ['{projectRoot}/generated/prisma'],
    options: {
      command: 'prisma generate',
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets['pull-image'] = {
    executor: 'nx:run-commands',
    options: {
      command: `tsx ${scriptsDir}/pull-image.ts`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets['dev'] = {
    executor: 'nx:run-commands',
    options: {
      command: `tsx ${scriptsDir}/start-container.ts`,
      cwd: '{projectRoot}',
    },
    continuous: true,
  };
  projectConfig.targets['wait-for-db'] = {
    executor: 'nx:run-commands',
    dependsOn: ['dev'],
    options: {
      command: `tsx ${scriptsDir}/${waitForDbScript}`,
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets.prisma = {
    executor: 'nx:run-commands',
    dependsOn: ['dev', 'wait-for-db'],
    options: {
      cwd: '{projectRoot}',
      command: 'prisma',
      env: {
        LOCAL_DEV: 'true',
      },
    },
  };
  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);
    if (iac === 'terraform') {
      projectConfig.targets['docker'] = {
        cache: true,
        executor: 'nx:run-commands',
        options: {
          command: `${containerEngine} build --platform linux/arm64 --provenance=false -t ${dockerImageTag} ${migrationBundleDir}`,
        },
        dependsOn: ['bundle'],
      };
      addDependencyToTargetIfNotPresent(projectConfig, 'build', 'docker');
    }
    addDependencyToTargetIfNotPresent(projectConfig, 'build', 'bundle');
  }
  addDependencyToTargetIfNotPresent(projectConfig, 'compile', 'generate');
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);
  addGeneratorMetadata(tree, fullyQualifiedName, TS_RDB_GENERATOR_INFO, {
    engine: options.engine,
  });

  if (options.infra !== 'none') {
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(tree, { iac });
    await addRdbInfra(tree, {
      iac,
      projectName: fullyQualifiedName,
      projectRoot: dir,
      nameClassName,
      nameKebabCase,
      databasePackageAlias: toScopeAlias(fullyQualifiedName),
      databaseName,
      adminUser: databaseUser,
      engine: options.engine === 'mysql' ? 'mysql' : 'postgres',
      migrationBundleDir,
      createDbUserBundleDir: joinPathFragments(
        'dist',
        projectConfig.root,
        'bundle',
        'create-db-user',
      ),
      dockerImageTag,
      containerEngine,
    });
  }

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      '@aws-sdk/client-secrets-manager',
      '@aws-sdk/rds-signer',
      '@prisma/client',
      ...(options.engine === 'mysql'
        ? (['@prisma/adapter-mariadb', 'mariadb'] as const)
        : (['@prisma/adapter-pg', 'pg'] as const)),
    ]),
    withVersions([
      'prisma',
      'tsx',
      '@types/aws-lambda',
      ...(options.engine === 'mysql'
        ? ([] as const)
        : (['@types/pg'] as const)),
    ]),
  );

  registerPnpmBuiltDependencies(tree, {
    '@prisma/engines': false,
    prisma: false,
  });

  await addGeneratorMetricsIfApplicable(tree, [TS_RDB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsRdbGenerator;
