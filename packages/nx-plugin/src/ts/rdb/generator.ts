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
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsRdbGeneratorSchema } from './schema';
import {
  addDependencyToTargetIfNotPresent,
  NxGeneratorInfo,
  getGeneratorInfo,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { addRdbInfra } from '../../utils/rdb-constructs/rdb-constructs';
import { toClassName, kebabCase } from '../../utils/names';
import { FsCommands } from '../../utils/fs';
import { getRelativePathToRootByDirectory } from '../../utils/paths';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import { addIgnoresToEslintConfig } from '../lib/eslint';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
import { resolveIacProvider } from '../../utils/iac';
import { getNpmScope, toScopeAlias } from '../../utils/npm-scope';
import { updateGitIgnore } from '../../utils/git';
import { assignPort } from '../../utils/port';

export const TS_RDB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbGenerator = async (
  tree: Tree,
  options: TsRdbGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = kebabCase(options.name);
  const nameClassName = toClassName(options.name);
  const databaseUser = options.databaseUser ?? 'dbadmin';
  const databaseName = (options.databaseName ?? nameKebabCase).toLowerCase();
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

  updateJson(tree, joinPathFragments(dir, 'tsconfig.lib.json'), (tsConfig) => ({
    ...tsConfig,
    include: ['src/**/*.ts', 'generated/prisma/**/*.ts'],
  }));
  await addIgnoresToEslintConfig(
    tree,
    joinPathFragments(dir, 'eslint.config.mjs'),
    ['**/generated/**', '**/out-tsc'],
  );

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const localDbPort = assignPort(
    tree,
    projectConfig,
    options.engine === 'MySQL' ? 3306 : 5432,
  );
  const localDbHost = 'localhost';
  const localDbUser = 'dbadmin';
  const localDbPassword = 'password';

  const templateOptions = {
    engine: options.engine,
    runtimeConfigKey: nameClassName,
    databasePackageAlias: toScopeAlias(fullyQualifiedName),
    databaseProvider: options.engine === 'MySQL' ? 'mysql' : 'postgresql',
    prismaVersion: TS_VERSIONS.prisma,
    prismaAdapterPackage:
      options.engine === 'MySQL'
        ? '@prisma/adapter-mariadb'
        : '@prisma/adapter-pg',
    prismaAdapterClassName:
      options.engine === 'MySQL' ? 'PrismaMariaDb' : 'PrismaPg',
    localDbPort,
    localDbHost,
    localDbName: databaseName,
    localDbUser,
    localDbPassword,
  };

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    dir,
    templateOptions,
  );
  updateGitIgnore(tree, dir, (patterns) => [...patterns, 'generated/prisma']);
  const relativePathToRoot = getRelativePathToRootByDirectory(
    projectConfig.root,
  );
  const fs = new FsCommands(tree);
  await addTypeScriptBundleTarget(tree, projectConfig, {
    targetFilePath: 'src/migration-handler.ts',
    bundleOutputDir: 'migration',
  });
  await addTypeScriptBundleTarget(tree, projectConfig, {
    targetFilePath: 'src/create-db-user-handler.ts',
    bundleOutputDir: 'create-db-user',
  });
  projectConfig.targets['bundle-migration'] = {
    cache: true,
    executor: 'nx:run-commands',
    outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle/migration'],
    options: {
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
      ],
      cwd: '{projectRoot}',
      parallel: false,
    },
  };
  addDependencyToTargetIfNotPresent(
    projectConfig,
    'bundle',
    'bundle-migration',
  );
  projectConfig.targets.generate = {
    executor: 'nx:run-commands',
    outputs: ['{projectRoot}/generated/prisma'],
    options: {
      command: 'prisma generate',
      cwd: '{projectRoot}',
    },
  };
  projectConfig.targets.prisma = {
    executor: 'nx:run-commands',
    dependsOn: ['serve-local'],
    options: {
      cwd: '{projectRoot}',
      command: 'prisma',
      env: {
        SERVE_LOCAL: 'true',
      },
    },
  };
  const containerPort = options.engine === 'MySQL' ? 3306 : 5432;
  const dockerImage = options.engine === 'MySQL' ? 'mysql' : 'postgres';
  const dockerDataDir =
    options.engine === 'MySQL' ? '/var/lib/mysql' : '/var/lib/postgresql';
  const dockerEnvArgs =
    options.engine === 'MySQL'
      ? `-e MYSQL_DATABASE=${databaseName} -e MYSQL_USER=${localDbUser} -e MYSQL_PASSWORD=${localDbPassword} -e MYSQL_ROOT_PASSWORD=${localDbPassword}`
      : `-e POSTGRES_DB=${databaseName} -e POSTGRES_USER=${localDbUser} -e POSTGRES_PASSWORD=${localDbPassword}`;
  const containerName = `${getNpmScope(tree)}-${databaseName}`;
  projectConfig.targets['serve-local'] = {
    executor: 'nx:run-commands',
    options: {
      command: `docker stop ${containerName} 2>/dev/null; docker run --rm -d --name ${containerName} -p ${localDbPort}:${containerPort} -v ${containerName}-data:${dockerDataDir} ${dockerEnvArgs} ${dockerImage}`,
      cwd: '{projectRoot}',
    },
  };
  const migrationBundleDir = joinPathFragments(
    'dist',
    projectConfig.root,
    'bundle',
    'migration',
  );
  const dockerImageTag = `${getNpmScope(tree)}-${kebabCase(options.name)}-migration:latest`;
  if (iacProvider === 'Terraform') {
    projectConfig.targets['docker'] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        command: `docker build --platform linux/arm64 --provenance=false --build-arg AWS_REGION=$AWS_DEFAULT_REGION -t ${dockerImageTag} ${migrationBundleDir}`,
      },
      dependsOn: ['bundle'],
    };
    addDependencyToTargetIfNotPresent(projectConfig, 'build', 'docker');
  }
  addDependencyToTargetIfNotPresent(projectConfig, 'compile', 'generate');
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);

  await sharedConstructsGenerator(tree, { iacProvider });
  await addRdbInfra(tree, {
    iacProvider,
    nameClassName,
    nameKebabCase,
    databasePackageAlias: toScopeAlias(fullyQualifiedName),
    databaseName,
    adminUser: databaseUser,
    engine: options.engine === 'MySQL' ? 'mysql' : 'postgres',
    migrationBundleDir,
    createDbUserBundleDir: joinPathFragments(
      'dist',
      projectConfig.root,
      'bundle',
      'create-db-user',
    ),
    dockerImageTag,
  });

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      '@aws-sdk/client-secrets-manager',
      '@aws-sdk/rds-signer',
      '@prisma/client',
      ...(options.engine === 'MySQL'
        ? (['@prisma/adapter-mariadb', 'mariadb'] as const)
        : (['@prisma/adapter-pg', 'pg'] as const)),
    ]),
    withVersions([
      'prisma',
      '@types/aws-lambda',
      ...(options.engine === 'MySQL'
        ? ([] as const)
        : (['@types/pg'] as const)),
    ]),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_RDB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsRdbGenerator;
