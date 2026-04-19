/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { tsRdbGenerator, TS_RDB_GENERATOR_INFO } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { METRICS_ASPECT_FILE_PATH } from '../../utils/metrics';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { readProjectConfigurationUnqualified } from '../../utils/nx';

const expectHasMetricTags = (tree: Tree, ...metrics: string[]) => {
  const content = tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8');
  expect(content).toBeTruthy();

  const tagsMatch = content!.match(
    /const tags:\s*string\[\]\s*=\s*\[([^\]]*)\]/,
  );
  expect(tagsMatch).toBeTruthy();

  const tagsContent = tagsMatch![1];
  const tags = tagsContent
    ? (tagsContent.match(/'([^']*)'/g)?.map((t) => t.slice(1, -1)) ?? [])
    : [];

  expect(tags).toEqual(expect.arrayContaining(metrics));
};

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
    const auroraConstruct = tree.read(
      'packages/common/constructs/src/core/rdb/aurora.ts',
      'utf-8',
    );
    const dbConstruct = tree.read(
      'packages/common/constructs/src/app/dbs/db.ts',
      'utf-8',
    );
    const prismaFile = tree.read('packages/db/src/prisma.ts', 'utf-8');
    const migrationHandler = tree.read(
      'packages/db/src/migration-handler.ts',
      'utf-8',
    );
    const createDbUserHandler = tree.read(
      'packages/db/src/create-db-user-handler.ts',
      'utf-8',
    );
    const utilsFile = tree.read('packages/db/src/utils.ts', 'utf-8');

    expect(auroraConstruct).toBeTruthy();
    expect(dbConstruct).toBeTruthy();
    expect(tree.exists('packages/db/src/prisma.ts')).toBeTruthy();
    expect(tree.exists('packages/db/src/utils.ts')).toBeTruthy();
    expect(
      tree.exists('packages/db/src/create-db-user-handler.ts'),
    ).toBeTruthy();
    expect(tree.exists('packages/db/prisma.config.ts')).toBeTruthy();
    expect(tree.exists('packages/db/prisma/schema.prisma')).toBeTruthy();
    expect(
      tree.exists('packages/db/prisma/schema/example.prisma'),
    ).toBeTruthy();
    expect(tree.exists('packages/db/src/index.ts')).toBeTruthy();
    expect(tree.exists('packages/db/Dockerfile')).toBeTruthy();
    expect(tree.exists('packages/db/.gitignore')).toBeTruthy();
    expect(tree.exists('packages/db/tsconfig.lib.json')).toBeTruthy();
    expect(tree.exists('packages/db/eslint.config.mjs')).toBeTruthy();
    expect(tree.exists('packages/db/src/migration-handler.ts')).toBeTruthy();
    expect(auroraConstruct).toContain('export abstract class AuroraDatabase');
    expect(auroraConstruct).toContain('createDbUserBundlePath');
    expect(auroraConstruct).toContain('RuntimeConfig.ensure(this)');
    expect(auroraConstruct).toContain("rc.set('database', runtimeConfigKey, {");
    expect(auroraConstruct).toContain('this.proxy = this.cluster.addProxy');
    expect(auroraConstruct).toContain('HOSTNAME: databaseHostname');
    expect(auroraConstruct).toContain('this.grantConnect(migrationHandler);');
    expect(dbConstruct).toContain('export class Db');
    expect(dbConstruct).toContain(
      "import { DB_PACKAGE_NAME } from ':proj/db';",
    );
    expect(dbConstruct).toContain("databaseName: 'databaseName'");
    expect(dbConstruct).toContain("adminUser: 'databaseUser'");
    expect(dbConstruct).toContain('runtimeConfigKey: DB_PACKAGE_NAME');
    expect(dbConstruct).toContain(
      "createDbUserBundlePath:\n        '../../../../../../dist/packages/db/bundle/create-db-user'",
    );
    expect(prismaFile).toContain(
      "import { PrismaPg } from '@prisma/adapter-pg';",
    );
    expect(prismaFile).toContain(
      "import { Signer } from '@aws-sdk/rds-signer';",
    );
    expect(prismaFile).toContain("import { Pool } from 'pg';");
    expect(prismaFile).toContain("export const DB_PACKAGE_NAME = 'Db';");
    expect(prismaFile).toContain('password: async () => {');
    expect(prismaFile).toContain('await getDatabaseConfig(DB_PACKAGE_NAME)');
    expect(prismaFile).toContain('allowExitOnIdle: true,');
    expect(migrationHandler).toContain(
      "import { Signer } from '@aws-sdk/rds-signer';",
    );
    expect(migrationHandler).toContain(
      "import { promisify } from 'node:util';",
    );
    expect(migrationHandler).toContain(
      "await promisify(execFile)('npx', ['prisma', 'migrate', 'deploy'],",
    );
    expect(migrationHandler).toContain('DATABASE_URL: databaseUrl');
    expect(migrationHandler).toContain('?sslaccept=strict');
    expect(createDbUserHandler).toContain(
      "import { Client, escapeIdentifier } from 'pg';",
    );
    expect(createDbUserHandler).toContain('GRANT rds_iam TO');
    expect(utilsFile).toContain(
      "import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';",
    );
    expect(utilsFile).toContain(
      "import {\n  GetSecretValueCommand,\n  SecretsManagerClient,\n} from '@aws-sdk/client-secrets-manager';",
    );
    expect(tree.read('packages/db/prisma.config.ts', 'utf-8')).toContain(
      "import { defineConfig } from 'prisma/config';",
    );
    expect(
      tree.read('packages/db/prisma/schema/example.prisma', 'utf-8'),
    ).toContain('model ExampleTable');
    expect(
      tree.read('packages/db/prisma/schema/example.prisma', 'utf-8'),
    ).toContain('column1     String');
    expect(tree.read('packages/db/prisma/schema.prisma', 'utf-8')).toContain(
      'provider = "postgresql"',
    );
    expect(tree.read('packages/db/src/index.ts', 'utf-8')?.trim()).toBe(
      "export { getPrisma, DB_PACKAGE_NAME } from './prisma.js';",
    );
    expect(tree.read('packages/db/Dockerfile', 'utf-8')).toContain(
      'FROM public.ecr.aws/lambda/nodejs:24',
    );
    expect(tree.read('packages/db/Dockerfile', 'utf-8')).toContain(
      'ARG AWS_REGION',
    );
    expect(tree.read('packages/db/Dockerfile', 'utf-8')).toContain(
      'RUN npm install prisma@7.6.0',
    );
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
      tree.read('packages/common/constructs/src/app/dbs/db.ts', 'utf-8'),
    ).toContain('../../../../../../dist/packages/db/bundle/migration');
    expect(
      tree.read('packages/common/constructs/src/app/dbs/db.ts', 'utf-8'),
    ).toContain('../../../../../../dist/packages/db/bundle/create-db-user');
    expect(
      tree.read('packages/common/constructs/src/core/index.ts', 'utf-8'),
    ).toContain('./rdb/aurora.js');
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain('./dbs/index.js');
    expect(
      tree.read('packages/common/constructs/src/app/dbs/index.ts', 'utf-8'),
    ).toContain('./db.js');
    expect(tree.read('packages/db/rolldown.config.ts', 'utf-8')).toContain(
      "input: 'src/migration-handler.ts'",
    );
    expect(tree.read('packages/db/rolldown.config.ts', 'utf-8')).toContain(
      "file: '../../dist/packages/db/bundle/migration/index.js'",
    );
    expect(tree.read('packages/db/rolldown.config.ts', 'utf-8')).toContain(
      "input: 'src/create-db-user-handler.ts'",
    );
    expect(tree.read('packages/db/rolldown.config.ts', 'utf-8')).toContain(
      "file: '../../dist/packages/db/bundle/create-db-user/index.js'",
    );
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
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    expect(projectConfig.targets.build.dependsOn).not.toContain(
      'bundle-migration',
    );
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');
    expect(packageJson.dependencies['@aws-lambda-powertools/parameters']).toBe(
      '2.32.0',
    );
    expect(packageJson.dependencies['@aws-sdk/client-appconfigdata']).toBe(
      '3.1029.0',
    );
    expect(packageJson.dependencies['@aws-sdk/client-secrets-manager']).toBe(
      '3.1030.0',
    );
    expect(packageJson.dependencies['@aws-sdk/rds-signer']).toBe('3.1030.0');
    expect(packageJson.dependencies['@prisma/adapter-pg']).toBe('7.6.0');
    expect(packageJson.dependencies['@prisma/client']).toBe('7.6.0');
    expect(packageJson.dependencies.pg).toBe('8.20.0');
    expect(packageJson.dependencies.mariadb).toBeUndefined();
    expect(packageJson.dependencies['@prisma/adapter-mariadb']).toBeUndefined();
    expect(packageJson.devDependencies['@types/aws-lambda']).toBe('8.10.161');
    expect(packageJson.devDependencies['@types/pg']).toBe('8.20.0');
    expect(packageJson.devDependencies.prisma).toBe('7.6.0');
    expect(packageJson.devDependencies.ncp).toBe('2.0.0');
    expect(packageJson.devDependencies.rimraf).toBe('6.1.3');
    expect(packageJson.devDependencies['make-dir-cli']).toBe('4.0.0');
  });

  it('should add mysql prisma dependencies when engine is MySQL', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      engine: 'MySQL',
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    const auroraConstruct = tree.read(
      'packages/common/constructs/src/core/rdb/aurora.ts',
      'utf-8',
    );
    const prismaFile = tree.read('packages/db/src/prisma.ts', 'utf-8');
    const migrationHandler = tree.read(
      'packages/db/src/migration-handler.ts',
      'utf-8',
    );
    const createDbUserHandler = tree.read(
      'packages/db/src/create-db-user-handler.ts',
      'utf-8',
    );
    const utilsFile = tree.read('packages/db/src/utils.ts', 'utf-8');
    const prismaSchema = tree.read('packages/db/prisma/schema.prisma', 'utf-8');

    expect(packageJson.dependencies['@aws-lambda-powertools/parameters']).toBe(
      '2.32.0',
    );
    expect(packageJson.dependencies['@aws-sdk/client-appconfigdata']).toBe(
      '3.1029.0',
    );
    expect(packageJson.dependencies['@aws-sdk/client-secrets-manager']).toBe(
      '3.1030.0',
    );
    expect(packageJson.dependencies['@aws-sdk/rds-signer']).toBe('3.1030.0');
    expect(packageJson.dependencies['@prisma/adapter-mariadb']).toBe('7.6.0');
    expect(packageJson.dependencies['@prisma/client']).toBe('7.6.0');
    expect(packageJson.dependencies.mariadb).toBe('3.5.2');
    expect(packageJson.dependencies['@prisma/adapter-pg']).toBeUndefined();
    expect(packageJson.dependencies.pg).toBeUndefined();
    expect(packageJson.devDependencies['@types/aws-lambda']).toBe('8.10.161');
    expect(packageJson.devDependencies['@types/pg']).toBeUndefined();
    expect(packageJson.devDependencies.prisma).toBe('7.6.0');
    expect(packageJson.devDependencies.ncp).toBe('2.0.0');
    expect(packageJson.devDependencies.rimraf).toBe('6.1.3');
    expect(packageJson.devDependencies['make-dir-cli']).toBe('4.0.0');
    expect(prismaFile).toContain(
      "import { PrismaMariaDb } from '@prisma/adapter-mariadb';",
    );
    expect(prismaFile).toContain("export const DB_PACKAGE_NAME = 'Db';");
    expect(prismaFile).toContain(
      'export const PRISMA_TTL_MS = 10 * 60 * 1000;',
    );
    expect(prismaFile).toContain('const iamAuthToken = await new Signer({');
    expect(prismaFile).toContain('password: iamAuthToken');
    expect(prismaFile).toContain('ssl: {');
    expect(migrationHandler).toContain(
      "import { getDatabaseSecret } from './utils.js';",
    );
    expect(migrationHandler).toContain('?sslaccept=strict');
    expect(createDbUserHandler).toContain(
      "import { createPool, type PoolConnection } from 'mariadb';",
    );
    expect(createDbUserHandler).toContain(
      "IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS'",
    );
    expect(createDbUserHandler).toContain('multipleStatements: true');
    expect(createDbUserHandler).toContain(
      'const quotedDbName = pool.escapeId(dbname);',
    );
    expect(prismaSchema).toContain('provider = "mysql"');
    expect(auroraConstruct).toContain(
      'DATABASE_SECRET_ARN: this.cluster.secret!.secretArn',
    );
    expect(auroraConstruct).toContain(
      'this.grantSecretRead(migrationHandler);',
    );
    expect(auroraConstruct).not.toContain('HOSTNAME: databaseHostname');
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
    expect(terraformApp).toContain('source = "../../../core/rdb/aurora"');
    expect(terraformApp).toContain('engine');
    expect(terraformApp).toContain('"aurora-postgresql"');
    expect(terraformApp).toContain('admin_user');
    expect(terraformApp).toContain('"databaseUser"');
    expect(terraformApp).toContain('namespace = "database"');
    expect(terraformApp).toContain('key       = "Db"');
    expect(terraformApp).toContain('application_name = "Db-runtime-config"');
    expect(terraformApp).toContain(
      '../../../../../../../dist/packages/db/bundle/migration',
    );
    expect(terraformApp).toContain(
      '../../../../../../../dist/packages/db/bundle/create-db-user',
    );
    expect(terraformApp).toContain(
      'DATABASE_SECRET_ARN = module.aurora.secret_arn',
    );
    expect(terraformApp).toContain('HOSTNAME = module.aurora.cluster_endpoint');
    expect(terraformApp).toContain(
      'dbuser:${module.aurora.cluster_resource_id}/${local.database_runtime_user}',
    );
    expect(terraformApp).toContain('null_resource.create_db_user_trigger');
    expect(terraformApp).toContain('output "database_runtime_user"');
    expect(terraformApp).toContain('output "appconfig_application_id"');
    expect(terraformCore).toContain('variable "admin_user"');
    expect(terraformCore).toContain('variable "enable_rds_proxy"');
    expect(terraformCore).toContain(
      'iam_database_authentication_enabled = true',
    );
    expect(terraformCore).toContain('count = var.enable_rds_proxy ? 1 : 0');
    expect(terraformCore).toContain('output "cluster_resource_id"');
    expect(terraformCore).toContain('output "kms_key_arn"');
    expect(terraformCore).toContain('output "admin_user"');
    expect(terraformCore).toContain('output "database_security_group_id"');
    expect(terraformCore).toContain('output "proxy_role_name"');
    expect(terraformCore).toContain('"secretsmanager:GetSecretValue"');
    expect(terraformCore).toContain('proxy_to_database');
    expect(terraformApp).toContain('--build-arg AWS_REGION=');
    expect(terraformApp).toContain('module.aurora.proxy_role_name');
    expect(terraformApp).toContain('module.aurora.database_security_group_id');
    expect(terraformApp).toContain('module.aurora.security_group_id');
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

    expect(terraformApp).toContain('engine');
    expect(terraformApp).toContain('"aurora-mysql"');
    expect(terraformApp).toContain(
      'DATABASE_SECRET_ARN = module.aurora.secret_arn',
    );
    expect(terraformApp).not.toContain(
      'HOSTNAME = module.aurora.cluster_endpoint',
    );
    expect(terraformCore).toContain('variable "enable_rds_proxy"');
    expect(terraformApp).toContain('--build-arg AWS_REGION=');
    expect(terraformApp).toContain('module.aurora.database_security_group_id');
    expect(terraformApp).not.toContain('module.aurora.security_group_id');
  });

  it('should generate CDK construct with RDS Proxy disabled', async () => {
    await tsRdbGenerator(tree, defaultOptions);
    const auroraConstruct = tree.read(
      'packages/common/constructs/src/core/rdb/aurora.ts',
      'utf-8',
    );

    expect(auroraConstruct).toContain('enableRdsProxy?: boolean');
    expect(auroraConstruct).toContain('enableRdsProxy = true');
    expect(auroraConstruct).toContain('if (enableRdsProxy)');
    expect(auroraConstruct).toContain(
      'this.proxy?.endpoint ?? this.cluster.clusterEndpoint.hostname',
    );
  });

  it('should generate Terraform modules with enable_rds_proxy variable', async () => {
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

    expect(terraformCore).toContain('variable "enable_rds_proxy"');
    expect(terraformCore).toContain('type        = bool');
    expect(terraformCore).toContain('default     = true');
    expect(terraformCore).toContain('count = var.enable_rds_proxy ? 1 : 0');
    expect(terraformCore).toContain(
      'var.enable_rds_proxy ? aws_db_proxy.aurora[0].endpoint : aws_rds_cluster.database.endpoint',
    );
    expect(terraformApp).toContain('enable_rds_proxy');
    expect(terraformApp).toContain(
      'enable_rds_proxy                = var.enable_rds_proxy',
    );
    expect(terraformApp).toContain('variable "enable_rds_proxy"');
    expect(terraformApp).toContain('module.aurora.proxy_role_name');
    expect(terraformCore).toContain('"secretsmanager:GetSecretValue"');
    expect(terraformCore).toContain('proxy_to_database');
    expect(terraformCore).toContain('output "proxy_role_name"');
  });

  it('should generate correct runtime config structure for Terraform', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      iacProvider: 'Terraform',
    });
    const terraformApp = tree.read(
      'packages/common/terraform/src/app/dbs/db/db.tf',
      'utf-8',
    );

    // Verify runtime config uses correct namespace and key structure
    expect(terraformApp).toContain('module "add_rdb_to_runtime_config"');
    expect(terraformApp).toContain(
      'source = "../../../core/runtime-config/entry"',
    );
    expect(terraformApp).toContain('namespace = "database"');
    expect(terraformApp).toContain('key       = "Db"');
    expect(terraformApp).toContain(
      'hostname  = module.aurora.cluster_endpoint',
    );
    expect(terraformApp).toContain('port      = module.aurora.cluster_port');
    expect(terraformApp).toContain('database  = module.aurora.database_name');
    expect(terraformApp).toContain('adminUser = module.aurora.admin_user');
    expect(terraformApp).toContain('dbUser    = local.database_runtime_user');
    expect(terraformApp).toContain('region    = data.aws_region.current.name');
  });
});
