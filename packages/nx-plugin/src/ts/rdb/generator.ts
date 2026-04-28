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
import { toClassName, toKebabCase } from '../../utils/names';
import { FsCommands } from '../../utils/fs';
import { getRelativePathToRootByDirectory } from '../../utils/paths';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import { addIgnoresToEslintConfig } from '../lib/eslint';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
import { resolveIacProvider } from '../../utils/iac';
import { toScopeAlias } from '../../utils/npm-scope';
import { updateGitIgnore } from '../../utils/git';

export const TS_RDB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbGenerator = async (
  tree: Tree,
  options: TsRdbGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = toKebabCase(options.name) ?? options.name;
  const nameClassName = toClassName(options.name);
  const iacProvider = await resolveIacProvider(tree, options.iacProvider);
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, {
    name: options.name,
    directory: options.directory,
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
  };

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    dir,
    templateOptions,
  );
  updateGitIgnore(tree, dir, (patterns) => [...patterns, 'generated/prisma']);

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
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
    options: {
      cwd: '{projectRoot}',
      command: 'prisma',
    },
  };
  addDependencyToTargetIfNotPresent(projectConfig, 'compile', 'generate');
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);

  await sharedConstructsGenerator(tree, { iacProvider });
  await addRdbInfra(tree, {
    iacProvider,
    nameClassName,
    nameKebabCase,
    databasePackageAlias: toScopeAlias(fullyQualifiedName),
    databaseName: options.databaseName,
    adminUser: options.databaseUser,
    engine: options.engine === 'MySQL' ? 'mysql' : 'postgres',
    migrationBundleDir: joinPathFragments(
      'dist',
      projectConfig.root,
      'bundle',
      'migration',
    ),
    createDbUserBundleDir: joinPathFragments(
      'dist',
      projectConfig.root,
      'bundle',
      'create-db-user',
    ),
  });

  const runtimeDependencies =
    options.engine === 'MySQL'
      ? withVersions([
          '@aws-lambda-powertools/parameters',
          '@aws-sdk/client-appconfigdata',
          '@aws-sdk/client-secrets-manager',
          '@aws-sdk/rds-signer',
          '@prisma/client',
          '@prisma/adapter-mariadb',
          'mariadb',
        ])
      : withVersions([
          '@aws-lambda-powertools/parameters',
          '@aws-sdk/client-appconfigdata',
          '@aws-sdk/client-secrets-manager',
          '@aws-sdk/rds-signer',
          '@prisma/client',
          '@prisma/adapter-pg',
          'pg',
        ]);

  addDependenciesToPackageJson(
    tree,
    runtimeDependencies,
    options.engine === 'MySQL'
      ? withVersions(['prisma', '@types/aws-lambda'])
      : withVersions(['prisma', '@types/pg', '@types/aws-lambda']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_RDB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsRdbGenerator;
