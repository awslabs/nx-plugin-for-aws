/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import * as devkit from '@nx/devkit';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import { readProjectConfigurationUnqualified } from '../../utils/nx.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test.js';
import { TS_VERSIONS } from '../../utils/versions.js';
import { TS_RDB_GENERATOR_INFO, tsRdbGenerator } from './generator.js';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

const TERRAFORM_AURORA_CORE =
  'packages/common/terraform/src/core/rdb/aurora/aurora.tf';
const TERRAFORM_AURORA_APP = 'packages/common/terraform/src/app/dbs/db/db.tf';

/** Declared name to default value for every optional variable in a module. */
const readTerraformVariableDefaults = (
  tree: Tree,
  filePath: string,
): Record<string, string> =>
  Object.fromEntries(
    [
      // Nested blocks are indented, so an unindented `}` closes the variable.
      ...tree
        .read(filePath, 'utf-8')
        .matchAll(/variable "(?<name>\w+)" \{\n(?<body>.*?)\n\}/gs),
    ]
      .map(({ groups }) => [
        groups.name,
        /^\s*default\s*=\s*(?<value>.+)$/m.exec(groups.body)?.groups.value,
      ])
      .filter(([, value]) => value !== undefined),
  );

/** The app module's call into the core module, with alignment padding collapsed. */
const readTerraformAuroraModuleCall = (tree: Tree): string =>
  /module "aurora" \{\n.*?\n\}/s
    .exec(tree.read(TERRAFORM_AURORA_APP, 'utf-8'))[0]
    .replace(/ +/g, ' ');

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
      inputs: ['default'],
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle'],
      executor: 'nx:run-commands',
      options: {
        commands: [
          'shx rm -rf ../../dist/{projectRoot}/bundle/migration',
          'shx mkdir -p ../../dist/{projectRoot}/bundle/migration',
          'shx cp -R prisma/. ../../dist/{projectRoot}/bundle/migration/prisma',
          'shx cp prisma.config.ts ../../dist/{projectRoot}/bundle/migration/prisma.config.ts',
          'shx cp Dockerfile ../../dist/{projectRoot}/bundle/migration/Dockerfile',
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
    expect(projectConfig.targets['dev']).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['pull-image'],
      options: {
        command: 'tsx ../common/scripts/src/rdb/start-container.ts',
        cwd: '{projectRoot}',
      },
      continuous: true,
    });
    expect(projectConfig.targets['wait-for-db']).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['dev'],
      options: {
        command: 'tsx ../common/scripts/src/rdb/wait-for-postgres-db.ts',
        cwd: '{projectRoot}',
      },
    });
    expect(
      tree.exists('packages/common/scripts/src/rdb/wait-for-postgres-db.ts'),
    ).toBe(true);
    expect(
      tree.exists('packages/common/scripts/src/rdb/wait-for-mysql-db.ts'),
    ).toBe(false);
    expect(
      tree.read(
        'packages/common/scripts/src/rdb/wait-for-postgres-db.ts',
        'utf-8',
      ),
    ).not.toContain('mariadb');
    expect(projectConfig.targets.prisma).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['dev', 'wait-for-db'],
      options: {
        cwd: '{projectRoot}',
        command: 'prisma',
        env: {
          LOCAL_DEV: 'true',
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
    // Runtime dependencies (and the @types/* backing type imports) land in the
    // project's own manifest as catalog references
    const projectPackageJson = JSON.parse(
      tree.read('packages/db/package.json', 'utf-8') ?? '{}',
    );
    expect(
      projectPackageJson.dependencies['@aws-lambda-powertools/parameters'],
    ).toBe('catalog:');
    expect(
      projectPackageJson.dependencies['@aws-sdk/client-appconfigdata'],
    ).toBe('catalog:');
    expect(
      projectPackageJson.dependencies['@aws-sdk/client-secrets-manager'],
    ).toBe('catalog:');
    expect(projectPackageJson.dependencies['@aws-sdk/rds-signer']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.dependencies['@prisma/adapter-pg']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.dependencies['@prisma/client']).toBe('catalog:');
    expect(projectPackageJson.dependencies.pg).toBe('catalog:');
    expect(projectPackageJson.dependencies.mariadb).toBeUndefined();
    expect(
      projectPackageJson.dependencies['@prisma/adapter-mariadb'],
    ).toBeUndefined();
    expect(projectPackageJson.devDependencies['@types/aws-lambda']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.devDependencies['@types/pg']).toBe('catalog:');

    // Pure build/test tooling stays in the workspace root devDependencies
    expect(packageJson.devDependencies['tsx']).toBeDefined();
    expect(packageJson.devDependencies.prisma).toBeDefined();
    expect(packageJson.devDependencies.shx).toBeDefined();
  });

  it('should add mysql prisma dependencies when engine is MySQL', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      engine: 'mysql',
    });

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
    expect(mysqlProjectConfig.targets['dev']).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['pull-image'],
      options: {
        command: 'tsx ../common/scripts/src/rdb/start-container.ts',
        cwd: '{projectRoot}',
      },
      continuous: true,
    });
    expect(mysqlProjectConfig.targets['wait-for-db']).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['dev'],
      options: {
        command: 'tsx ../common/scripts/src/rdb/wait-for-mysql-db.ts',
        cwd: '{projectRoot}',
      },
    });
    expect(
      tree.exists('packages/common/scripts/src/rdb/wait-for-mysql-db.ts'),
    ).toBe(true);
    expect(
      tree.exists('packages/common/scripts/src/rdb/wait-for-postgres-db.ts'),
    ).toBe(false);
    expect(
      tree.read(
        'packages/common/scripts/src/rdb/wait-for-mysql-db.ts',
        'utf-8',
      ),
    ).not.toContain("import('pg')");
    const projectPackageJson = JSON.parse(
      tree.read('packages/db/package.json', 'utf-8') ?? '{}',
    );
    expect(projectPackageJson.dependencies['@prisma/adapter-mariadb']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.dependencies.mariadb).toBe('catalog:');
    expect(
      projectPackageJson.dependencies['@prisma/adapter-pg'],
    ).toBeUndefined();
    expect(projectPackageJson.dependencies.pg).toBeUndefined();
    expect(projectPackageJson.devDependencies?.['@types/pg']).toBeUndefined();
  });

  it('should pin @prisma/adapter-pg @types/pg via yarn resolutions to match the workspace @types/pg', async () => {
    vi.spyOn(devkit, 'detectPackageManager').mockReturnValue('yarn');

    await tsRdbGenerator(tree, defaultOptions);

    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    // Classic yarn honours the `**/` form, berry the bare one.
    expect(
      rootPackageJson.resolutions?.['**/@prisma/adapter-pg/@types/pg'],
    ).toBe(TS_VERSIONS['@types/pg']);
    expect(rootPackageJson.resolutions?.['@prisma/adapter-pg/@types/pg']).toBe(
      TS_VERSIONS['@types/pg'],
    );
  });

  it('should not add the @types/pg resolution for yarn when engine is MySQL', async () => {
    vi.spyOn(devkit, 'detectPackageManager').mockReturnValue('yarn');

    await tsRdbGenerator(tree, { ...defaultOptions, engine: 'mysql' });

    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(rootPackageJson.resolutions).toBeUndefined();
  });

  it.each(['pnpm', 'npm', 'bun'] as const)(
    'should not add yarn resolutions for %s',
    async (pkgMgr) => {
      vi.spyOn(devkit, 'detectPackageManager').mockReturnValue(pkgMgr);

      await tsRdbGenerator(tree, defaultOptions);

      const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(rootPackageJson.resolutions).toBeUndefined();
    },
  );

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

  it('should host database container images in the shared asset registry', async () => {
    await tsRdbGenerator(tree, { ...defaultOptions, iac: 'terraform' });
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      name: 'other-db',
      iac: 'terraform',
    });

    // Both databases publish their migration image to the one shared registry
    // rather than each provisioning a repository of its own.
    for (const [name, prefix] of [
      ['db', 'db'],
      ['other-db', 'other-db'],
    ]) {
      const dbModule = tree.read(
        `packages/common/terraform/src/app/dbs/${name}/${name}.tf`,
        'utf-8',
      );
      expect(dbModule).toContain('variable "asset_ecr_repository_url"');
      expect(dbModule).not.toContain('aws_ecr_repository');
      expect(dbModule).toContain(
        'image_uri     = "${var.asset_ecr_repository_url}:${local.image_tag}"',
      );
      // Sharing one repository means the tags must not collide, so each
      // database namespaces its content-addressed tag with its own name.
      expect(dbModule).toContain(
        `image_tag = "${prefix}-migration-\${replace(data.external.docker_digest.result.digest, "sha256:", "")}"`,
      );
    }
  });

  it('should protect the aurora cluster and its key from destruction in terraform', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      iac: 'terraform',
    });

    const aurora = tree.read(
      'packages/common/terraform/src/core/rdb/aurora/aurora.tf',
      'utf-8',
    );

    // Terraform-side guard, independent of the RDS-side deletion_protection
    // flag, so clearing that variable alone cannot destroy the cluster. It must
    // be a literal — prevent_destroy cannot reference a variable.
    expect(aurora).toContain('prevent_destroy = true');

    // The maximum KMS pending window, matching the CDK default, so a snapshot
    // of an encrypted cluster stays restorable for as long as possible.
    expect(aurora).toContain('deletion_window_in_days = 30');
  });

  it('should agree on every aurora variable default between the terraform app and core modules', async () => {
    await tsRdbGenerator(tree, { ...defaultOptions, iac: 'terraform' });

    const core = readTerraformVariableDefaults(tree, TERRAFORM_AURORA_CORE);
    const app = readTerraformVariableDefaults(tree, TERRAFORM_AURORA_APP);

    // A root configuration instantiates the app module, which forwards its own
    // value down, so a differing default there silently overrides the core one.
    const shared = Object.keys(core).filter((name) => name in app);
    expect(Object.fromEntries(shared.map((n) => [n, app[n]]))).toEqual(
      Object.fromEntries(shared.map((n) => [n, core[n]])),
    );

    // Every re-declared variable must forward its own value down, so the app
    // module's default is the one that takes effect.
    const moduleCall = readTerraformAuroraModuleCall(tree);
    for (const name of shared) {
      expect(moduleCall).toContain(`${name} = var.${name}`);
    }

    // Any optional core variable the app module does not re-declare is
    // unreachable from a root configuration. `engine` is the one exception —
    // the generator fixes it from the chosen engine.
    expect(Object.keys(core).filter((name) => !(name in app))).toEqual([
      'engine',
    ]);
  });

  it.each([
    ['postgres', '["postgresql"]', 'log_statement'],
    ['mysql', '["audit", "error"]', 'server_audit_events'],
  ] as const)(
    'should export %s engine logs and create the cluster parameter group by default in terraform',
    async (engine, exports, parameter) => {
      await tsRdbGenerator(tree, {
        ...defaultOptions,
        iac: 'terraform',
        engine,
      });

      expect(
        readTerraformVariableDefaults(tree, TERRAFORM_AURORA_APP)
          .enable_cloudwatch_logs,
      ).toBe('true');

      // The same variable count-gates the cluster parameter group, which is what
      // configures the engine to emit the logs it exports.
      const core = tree.read(TERRAFORM_AURORA_CORE, 'utf-8');
      expect(core).toContain('count = var.enable_cloudwatch_logs ? 1 : 0');
      expect(core).toContain(exports);
      expect(core).toContain(parameter);
    },
  );

  it.each(['postgres', 'mysql'] as const)(
    'should grant the terraform rds proxy role only rds-db:connect for %s',
    async (engine) => {
      await tsRdbGenerator(tree, {
        ...defaultOptions,
        iac: 'terraform',
        engine,
      });

      const db = tree.read(TERRAFORM_AURORA_APP, 'utf-8');

      // The proxy is created with default_auth_scheme = IAM_AUTH and no secrets
      // registered, so rds-db:connect for the application user is the only
      // permission it needs to reach the cluster — on either engine.
      expect(db).toContain('Action = ["rds-db:connect"]');

      const proxyPolicy = db?.slice(
        db.indexOf('resource "aws_iam_role_policy" "proxy_db_user_connect"'),
        db.indexOf('module "add_rdb_to_runtime_config"'),
      );
      expect(proxyPolicy).not.toContain('secretsmanager:GetSecretValue');
      expect(proxyPolicy).not.toContain('kms:Decrypt');
    },
  );

  it('should keep an existing aurora shared construct', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );
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
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );

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

  it('should place the project in a subDirectory when provided', async () => {
    await tsRdbGenerator(tree, { ...defaultOptions, subDirectory: 'nested' });

    const projectConfig = readProjectConfigurationUnqualified(tree, '@proj/db');
    expect(projectConfig.root).toBe('packages/nested');
    expect(tree.exists('packages/nested/package.json')).toBe(true);
    expect(tree.exists('packages/db/package.json')).toBe(false);
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

  // Re-running must not destroy the schema and edits the user owns — the whole
  // point of re-running is usually to add infrastructure to an existing project.
  it('should preserve user edits to user-owned files on a re-run', async () => {
    await tsRdbGenerator(tree, { ...defaultOptions, infra: 'none' });

    const userOwned = {
      'packages/db/prisma/models/example.prisma': `model MyModel {
  id String @id
}
`,
      'packages/db/prisma/schema.prisma': '// user edited schema\n',
      'packages/db/src/prisma.ts': '// user edited prisma client\n',
      'packages/db/src/utils.ts': '// user edited utils\n',
    };
    for (const [path, contents] of Object.entries(userOwned)) {
      expect(tree.exists(path)).toBe(true);
      tree.write(path, contents);
    }

    await tsRdbGenerator(tree, defaultOptions);

    for (const [path, contents] of Object.entries(userOwned)) {
      expect(tree.read(path, 'utf-8')).toBe(contents);
    }
  });

  // config.json is framework-owned, so changed options must land on a re-run.
  it('should converge framework-owned files on a re-run with changed options', async () => {
    await tsRdbGenerator(tree, { ...defaultOptions, engine: 'postgres' });
    await tsRdbGenerator(tree, { ...defaultOptions, engine: 'mysql' });

    const config = JSON.parse(
      tree.read('packages/db/config.json', 'utf-8') ?? '{}',
    );
    expect(config.localDev.dbEngine).toBe('mysql');
    expect(tree.read('packages/db/src/index.ts', 'utf-8')).toContain(
      "export * from './prisma.js'",
    );
  });
});
