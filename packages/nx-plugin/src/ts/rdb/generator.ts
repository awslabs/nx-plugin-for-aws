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
import { addRdbCdkConstructs } from '../../utils/rdb-constructs/rdb-constructs';
import { toClassName, toKebabCase } from '../../utils/names';
import { FsCommands } from '../../utils/fs';
import { getRelativePathToRootByDirectory } from '../../utils/paths';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import { addIgnoresToEslintConfig } from '../lib/eslint';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { TS_VERSIONS, withVersions } from '../../utils/versions';

export const TS_RDB_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbGenerator = async (
  tree: Tree,
  options: TsRdbGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = toKebabCase(options.name) ?? options.name;
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
    include: ['src/**/*.ts', 'lib/**/*.ts', 'generated/prisma/**/*.ts'],
  }));
  await addIgnoresToEslintConfig(
    tree,
    joinPathFragments(dir, 'eslint.config.mjs'),
    ['**/generated/**', '**/out-tsc'],
  );

  const templateOptions = {
    engine: options.engine,
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

  const projectConfig = readProjectConfiguration(tree, fullyQualifiedName);
  const relativePathToRoot = getRelativePathToRootByDirectory(
    projectConfig.root,
  );
  const fs = new FsCommands(tree);
  await addTypeScriptBundleTarget(tree, projectConfig, {
    targetFilePath: 'src/migration-handler.ts',
    bundleOutputDir: 'migration',
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
  addDependencyToTargetIfNotPresent(projectConfig, 'compile', 'generate');
  updateProjectConfiguration(tree, fullyQualifiedName, projectConfig);

  await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
  await addRdbCdkConstructs(tree, {
    nameClassName: toClassName(options.name),
    nameKebabCase,
    databaseName: options.databaseName,
    databaseUser: options.databaseUser,
    engine: options.engine === 'MySQL' ? 'mysql' : 'postgres',
    migrationBundlePathFromRoot: joinPathFragments(
      'dist',
      projectConfig.root,
      'bundle',
      'migration',
    ),
  });

  const runtimeDependencies =
    options.engine === 'MySQL'
      ? withVersions(['@prisma/client', '@prisma/adapter-mariadb'])
      : withVersions(['@prisma/client', '@prisma/adapter-pg', 'pg']);

  addDependenciesToPackageJson(
    tree,
    runtimeDependencies,
    withVersions(['prisma']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_RDB_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsRdbGenerator;
