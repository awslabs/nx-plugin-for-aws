/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { readProjectConfigurationUnqualified } from '../../utils/nx';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { TS_RDB_GENERATOR_INFO, tsRdbGenerator } from './generator';

describe('ts#rdb generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const defaultOptions = {
    name: 'db',
    directory: 'packages',
    infra: 'aurora' as const,
    engine: 'postgres' as const,
    databaseUser: 'databaseUser',
    databaseName: 'databaseName',
    framework: 'prisma' as const,
    iac: 'cdk' as const,
  };

  it('should generate the aurora shared construct', async () => {
    await tsRdbGenerator(tree, defaultOptions);
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    const projectConfig = readProjectConfigurationUnqualified(tree, '@proj/db');
    expect(
      tree.read('packages/common/constructs/src/core/rdb/aurora.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/constructs/src/app/dbs/db.ts', 'utf-8'),
    ).toMatchSnapshot();
    snapshotTreeDir(tree, 'packages/db/src');
    snapshotTreeDir(tree, 'packages/db/prisma');
    expect(
      tree.read('packages/db/prisma.config.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(tree.read('packages/db/Dockerfile', 'utf-8')).toMatchSnapshot();
    expect(
      tree.read('packages/db/rolldown.config.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(tree.read('packages/db/.gitignore', 'utf-8')).toContain(
      'generated/prisma',
    );
    expect(
      JSON.parse(tree.read('packages/db/tsconfig.lib.json', 'utf-8') ?? '{}')
        .include,
    ).toEqual(['src/**/*.ts', 'generated/prisma/**/*.ts']);
    expect(
      tree.read('packages/common/constructs/src/core/index.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/constructs/src/app/dbs/index.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(projectConfig.targets.bundle).toEqual({
      cache: true,
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle'],
      executor: 'nx:run-commands',
      options: {
        commands: [
          'rimraf ../../dist/{projectRoot}/bundle/migration',
          'make-dir ../../dist/{projectRoot}/bundle/migration',
          'ncp prisma ../../dist/{projectRoot}/bundle/migration/prisma',
          'ncp prisma.config.ts ../../dist/{projectRoot}/bundle/migration/prisma.config.ts',
          'ncp Dockerfile ../../dist/{projectRoot}/bundle/migration/Dockerfile',
          'rolldown -c rolldown.config.ts',
        ],
        cwd: '{projectRoot}',
        parallel: false,
      },
      dependsOn: ['compile'],
    });
    expect(projectConfig.targets.generate).toEqual({
      executor: 'nx:run-commands',
      outputs: ['{projectRoot}/generated/prisma'],
      options: {
        command: 'prisma generate',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets['pull-image']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command: 'tsx ../common/scripts/src/rdb/pull-image.ts',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets['serve-local']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command: 'tsx ../common/scripts/src/rdb/start-container.ts',
        cwd: '{projectRoot}',
      },
      continuous: true,
    });
    expect(projectConfig.targets['wait-for-db']).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['serve-local'],
      options: {
        command: 'tsx ../common/scripts/src/rdb/wait-for-db.ts',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets.prisma).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['serve-local', 'wait-for-db'],
      options: {
        cwd: '{projectRoot}',
        command: 'prisma',
        env: {
          SERVE_LOCAL: 'true',
        },
      },
    });
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');
    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      '@proj/db:build',
    );
    expect(
      packageJson.dependencies['@aws-lambda-powertools/parameters'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/client-appconfigdata'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/client-secrets-manager'],
    ).toBeDefined();
    expect(packageJson.dependencies['@aws-sdk/rds-signer']).toBeDefined();
    expect(packageJson.dependencies['@prisma/adapter-pg']).toBeDefined();
    expect(packageJson.dependencies['@prisma/client']).toBeDefined();
    expect(packageJson.dependencies.pg).toBeDefined();
    expect(packageJson.dependencies.mariadb).toBeUndefined();
    expect(packageJson.dependencies['@prisma/adapter-mariadb']).toBeUndefined();
    expect(packageJson.devDependencies['tsx']).toBeDefined();
    expect(packageJson.devDependencies['@types/aws-lambda']).toBeDefined();
    expect(packageJson.devDependencies['@types/pg']).toBeDefined();
    expect(packageJson.devDependencies.prisma).toBeDefined();
    expect(packageJson.devDependencies.ncp).toBeDefined();
    expect(packageJson.devDependencies.rimraf).toBeDefined();
    expect(packageJson.devDependencies['make-dir-cli']).toBeDefined();
  });

  it('should add mysql prisma dependencies when engine is MySQL', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      engine: 'mysql',
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');

    expect(
      tree.read('packages/common/constructs/src/core/rdb/aurora.ts', 'utf-8'),
    ).toMatchSnapshot();
    snapshotTreeDir(tree, 'packages/db/src');
    snapshotTreeDir(tree, 'packages/db/prisma');
    expect(
      tree.read('packages/db/prisma.config.ts', 'utf-8'),
    ).toMatchSnapshot();

    const mysqlProjectConfig = readProjectConfigurationUnqualified(
      tree,
      '@proj/db',
    );
    expect(mysqlProjectConfig.targets['pull-image']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command: 'tsx ../common/scripts/src/rdb/pull-image.ts',
        cwd: '{projectRoot}',
      },
    });
    expect(mysqlProjectConfig.targets['serve-local']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command: 'tsx ../common/scripts/src/rdb/start-container.ts',
        cwd: '{projectRoot}',
      },
      continuous: true,
    });
    expect(mysqlProjectConfig.targets['wait-for-db']).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['serve-local'],
      options: {
        command: 'tsx ../common/scripts/src/rdb/wait-for-db.ts',
        cwd: '{projectRoot}',
      },
    });
    expect(packageJson.dependencies['@prisma/adapter-mariadb']).toBeDefined();
    expect(packageJson.dependencies.mariadb).toBeDefined();
    expect(packageJson.dependencies['@prisma/adapter-pg']).toBeUndefined();
    expect(packageJson.dependencies.pg).toBeUndefined();
    expect(packageJson.devDependencies['@types/pg']).toBeUndefined();
  });

  it('should generate terraform modules when iac is Terraform', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      iac: 'terraform',
    });
    expect(
      tree.read(
        'packages/common/terraform/src/core/rdb/aurora/aurora.tf',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/terraform/src/app/dbs/db/db.tf', 'utf-8'),
    ).toMatchSnapshot();
    const sharedTerraformConfig = JSON.parse(
      tree.read('packages/common/terraform/project.json', 'utf-8') ?? '{}',
    );
    expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
      '@proj/db:build',
    );
  });

  it('should keep an existing aurora shared construct', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });
    tree.write(
      'packages/common/constructs/src/core/rdb/aurora.ts',
      '// preserve custom aurora construct',
    );

    await tsRdbGenerator(tree, defaultOptions);

    expect(
      tree
        .read('packages/common/constructs/src/core/rdb/aurora.ts', 'utf-8')
        ?.trim(),
    ).toBe('// preserve custom aurora construct');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await tsRdbGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, TS_RDB_GENERATOR_INFO.metric);
  });

  it('should generate terraform modules with MySQL engine', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      iac: 'terraform',
      engine: 'mysql',
    });
    expect(
      tree.read(
        'packages/common/terraform/src/core/rdb/aurora/aurora.tf',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/terraform/src/app/dbs/db/db.tf', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should generate with infra=none then upgrade to infra=aurora', async () => {
    await tsRdbGenerator(tree, { ...defaultOptions, infra: 'none' });

    expect(tree.exists('packages/db/prisma')).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    const projectJson = JSON.parse(
      tree.read('packages/db/project.json', 'utf-8'),
    );
    expect(projectJson.targets['bundle']).toBeUndefined();

    await tsRdbGenerator(tree, defaultOptions);

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
    const updatedProjectJson = JSON.parse(
      tree.read('packages/db/project.json', 'utf-8'),
    );
    expect(updatedProjectJson.targets['bundle']).toBeDefined();
  });

  it('should be idempotent when re-run with same options', async () => {
    await tsRdbGenerator(tree, defaultOptions);
    await tsRdbGenerator(tree, defaultOptions);

    const projectConfig = readProjectConfigurationUnqualified(tree, '@proj/db');

    // Port metadata should not grow on re-run
    expect((projectConfig.metadata as any).ports).toHaveLength(1);

    // The rolldown command must survive the re-run and not be lost or duplicated
    const bundleCommands = projectConfig.targets.bundle.options
      .commands as string[];
    expect(bundleCommands).toContain('rolldown -c rolldown.config.ts');
    expect(
      bundleCommands.filter((c) => c === 'rolldown -c rolldown.config.ts'),
    ).toHaveLength(1);
    expect(bundleCommands.every((c) => c !== undefined)).toBe(true);

    // The shared constructs build dependency must not be duplicated
    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    const buildDeps = sharedConstructsConfig.targets.build.dependsOn as any[];
    expect(buildDeps.filter((d) => d === '@proj/db:build')).toHaveLength(1);
  });
});
