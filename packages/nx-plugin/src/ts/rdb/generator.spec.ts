/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { tsRdbGenerator, TS_RDB_GENERATOR_INFO } from './generator';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { readProjectConfigurationUnqualified } from '../../utils/nx';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('ts#rdb generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const defaultOptions = {
    name: 'db',
    directory: 'packages',
    service: 'Aurora' as const,
    engine: 'Postgres' as const,
    databaseUser: 'databaseUser',
    databaseName: 'databaseName',
    ormFramework: 'Prisma' as const,
    iacProvider: 'CDK' as const,
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
    expect(tree.read('packages/db/eslint.config.mjs', 'utf-8')).toContain(
      "'**/generated/**'",
    );
    expect(tree.read('packages/db/eslint.config.mjs', 'utf-8')).toContain(
      "'**/out-tsc'",
    );
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
        command: 'rolldown -c rolldown.config.ts',
        cwd: '{projectRoot}',
      },
      dependsOn: ['compile', 'bundle-migration'],
    });
    expect(projectConfig.targets['bundle-migration']).toEqual({
      cache: true,
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle/migration'],
      options: {
        commands: [
          'rimraf ../../dist/{projectRoot}/bundle/migration',
          'make-dir ../../dist/{projectRoot}/bundle/migration',
          'ncp prisma ../../dist/{projectRoot}/bundle/migration/prisma',
          'ncp prisma.config.ts ../../dist/{projectRoot}/bundle/migration/prisma.config.ts',
          'ncp Dockerfile ../../dist/{projectRoot}/bundle/migration/Dockerfile',
        ],
        cwd: '{projectRoot}',
        parallel: false,
      },
    });
    expect(projectConfig.targets.generate).toEqual({
      executor: 'nx:run-commands',
      outputs: ['{projectRoot}/generated/prisma'],
      options: {
        command: 'prisma generate',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets.prisma).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['serve-local'],
      options: {
        cwd: '{projectRoot}',
        command: 'prisma',
        env: {
          SERVE_LOCAL: 'true',
        },
      },
    });
    expect(projectConfig.targets['serve-local']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command:
          'docker stop proj-databasename 2>/dev/null; docker run --rm -d --name proj-databasename -p 5432:5432 -v proj-databasename-data:/var/lib/postgresql -e POSTGRES_DB=databasename -e POSTGRES_USER=dbadmin -e POSTGRES_PASSWORD=password postgres',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');
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
      engine: 'MySQL',
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
    expect(mysqlProjectConfig.targets['serve-local']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command:
          'docker stop proj-databasename 2>/dev/null; docker run --rm -d --name proj-databasename -p 3306:3306 -v proj-databasename-data:/var/lib/mysql -e MYSQL_DATABASE=databasename -e MYSQL_USER=dbadmin -e MYSQL_PASSWORD=password -e MYSQL_ROOT_PASSWORD=password mysql',
        cwd: '{projectRoot}',
      },
    });
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
    expect(packageJson.dependencies['@prisma/adapter-mariadb']).toBeDefined();
    expect(packageJson.dependencies['@prisma/client']).toBeDefined();
    expect(packageJson.dependencies.mariadb).toBeDefined();
    expect(packageJson.dependencies['@prisma/adapter-pg']).toBeUndefined();
    expect(packageJson.dependencies.pg).toBeUndefined();
    expect(packageJson.devDependencies['@types/aws-lambda']).toBeDefined();
    expect(packageJson.devDependencies['@types/pg']).toBeUndefined();
    expect(packageJson.devDependencies.prisma).toBeDefined();
    expect(packageJson.devDependencies.ncp).toBeDefined();
    expect(packageJson.devDependencies.rimraf).toBeDefined();
    expect(packageJson.devDependencies['make-dir-cli']).toBeDefined();
  });

  it('should generate terraform modules when iacProvider is Terraform', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      iacProvider: 'Terraform',
    });
    const terraformCore = tree.read(
      'packages/common/terraform/src/core/rdb/aurora/aurora.tf',
      'utf-8',
    );
    const terraformApp = tree.read(
      'packages/common/terraform/src/app/dbs/db/db.tf',
      'utf-8',
    );

    expect(
      tree.exists('packages/common/terraform/src/core/rdb/aurora/aurora.tf'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/terraform/src/app/dbs/db/db.tf'),
    ).toBeTruthy();
    expect(terraformApp).toContain('"aurora-postgresql"');
    expect(terraformApp).toContain('HOSTNAME = module.aurora.cluster_endpoint');

    expect({
      'aurora.tf': terraformCore,
      'db.tf': terraformApp,
    }).toMatchSnapshot();
  });

  it('should keep an existing aurora shared construct', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
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
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await tsRdbGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, TS_RDB_GENERATOR_INFO.metric);
  });

  it('should generate terraform modules with MySQL engine', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      iacProvider: 'Terraform',
      engine: 'MySQL',
    });
    const terraformCore = tree.read(
      'packages/common/terraform/src/core/rdb/aurora/aurora.tf',
      'utf-8',
    );
    const terraformApp = tree.read(
      'packages/common/terraform/src/app/dbs/db/db.tf',
      'utf-8',
    );

    expect(terraformApp).toContain('"aurora-mysql"');
    expect(terraformApp).toContain(
      'DATABASE_SECRET_ARN = module.aurora.secret_arn',
    );
    expect(terraformApp).not.toContain(
      'HOSTNAME = module.aurora.cluster_endpoint',
    );
    expect(terraformApp).toContain(
      'referenced_security_group_id = module.aurora.database_security_group_id',
    );
    expect(terraformApp).not.toContain(
      'referenced_security_group_id = module.aurora.security_group_id',
    );

    expect({
      'aurora.tf': terraformCore,
      'db.tf': terraformApp,
    }).toMatchSnapshot();
  });
});
