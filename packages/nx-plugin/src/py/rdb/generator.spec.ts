/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { resolveContainers } from '../../utils/containers';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { readProjectConfigurationUnqualified } from '../../utils/nx';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { PY_RDB_GENERATOR_INFO, pyRdbGenerator } from './generator';

vi.mock('../../utils/containers', () => ({
  resolveContainers: vi.fn(),
}));

describe('py#rdb generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(resolveContainers).mockResolvedValue('docker');
  });

  const defaultOptions = {
    name: 'db',
    directory: 'packages',
    infra: 'aurora' as const,
    engine: 'postgres' as const,
    databaseUser: 'databaseUser',
    databaseName: 'databaseName',
    iac: 'cdk' as const,
  };

  it('should generate a PostgreSQL SQLModel project with Alembic', async () => {
    await pyRdbGenerator(tree, defaultOptions);

    const projectConfig = readProjectConfigurationUnqualified(tree, 'proj.db');
    const pyproject = tree.read('packages/db/pyproject.toml', 'utf-8');

    snapshotTreeDir(tree, 'packages/db/proj_db');
    snapshotTreeDir(tree, 'packages/db/migrations');
    expect(tree.read('packages/db/alembic.ini', 'utf-8')).toMatchSnapshot();
    expect(
      tree.read('packages/db/Dockerfile.migration', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/db/Dockerfile.create-db-user', 'utf-8'),
    ).toMatchSnapshot();
    expect(tree.read('packages/db/config.json', 'utf-8')).toMatchSnapshot();
    expect(pyproject).toMatchSnapshot();

    expect(pyproject).toContain('sqlmodel==0.0.38');
    expect(pyproject).toContain('alembic==1.18.4');
    expect(pyproject).toContain('psycopg[binary,pool]==3.3.4');
    expect(pyproject).not.toContain('psycopg2-binary');
    expect(projectConfig.targets['bundle-arm']).toEqual({
      cache: true,
      inputs: ['default', '^production'],
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle-arm'],
      options: {
        commands: [
          'uv export --frozen --no-dev --no-editable --project {projectRoot} --package proj.db -o dist/{projectRoot}/bundle-arm/requirements.txt',
          'uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux_2_28 --target dist/{projectRoot}/bundle-arm -r dist/{projectRoot}/bundle-arm/requirements.txt',
        ],
        parallel: false,
      },
      dependsOn: ['compile'],
    });
    expect(projectConfig.targets['bundle-migration']).toEqual({
      cache: true,
      outputs: ['{workspaceRoot}/dist/{projectRoot}/docker/migration'],
      executor: 'nx:run-commands',
      options: {
        commands: [
          'rimraf dist/packages/db/docker/migration',
          'make-dir dist/packages/db/docker/migration',
          'ncp dist/packages/db/bundle-arm dist/packages/db/docker/migration',
          'ncp packages/db/migrations dist/packages/db/docker/migration/migrations',
          'ncp packages/db/alembic.ini dist/packages/db/docker/migration/alembic.ini',
          'ncp packages/db/Dockerfile.migration dist/packages/db/docker/migration/Dockerfile',
        ],
        parallel: false,
      },
      dependsOn: ['bundle-arm'],
    });
    expect(projectConfig.targets['bundle-create-db-user']).toEqual({
      cache: true,
      outputs: ['{workspaceRoot}/dist/{projectRoot}/docker/create-db-user'],
      executor: 'nx:run-commands',
      options: {
        commands: [
          'rimraf dist/packages/db/docker/create-db-user',
          'make-dir dist/packages/db/docker/create-db-user',
          'ncp dist/packages/db/bundle-arm dist/packages/db/docker/create-db-user',
          'ncp packages/db/Dockerfile.create-db-user dist/packages/db/docker/create-db-user/Dockerfile',
        ],
        parallel: false,
      },
      dependsOn: ['bundle-arm'],
    });
    expect(projectConfig.targets.migrate).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['dev', 'wait-for-db'],
      options: {
        command: 'uv run alembic upgrade head',
        cwd: '{projectRoot}',
        env: { LOCAL_DEV: 'true' },
      },
    });
    expect(projectConfig.targets.alembic).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['dev', 'wait-for-db'],
      options: {
        command: 'uv run alembic',
        cwd: '{projectRoot}',
        env: { LOCAL_DEV: 'true' },
      },
    });
    expect(projectConfig.targets.bundle.dependsOn).toContain(
      'bundle-migration',
    );
    expect(projectConfig.targets.bundle.dependsOn).toContain(
      'bundle-create-db-user',
    );
    expect(projectConfig.targets.build.dependsOn).toContain('bundle-migration');
    expect(projectConfig.targets.build.dependsOn).toContain(
      'bundle-create-db-user',
    );
    const databaseConstruct = tree.read(
      'packages/common/constructs/src/app/dbs/db.ts',
      'utf-8',
    );
    expect(databaseConstruct).toMatchSnapshot();
    expect(databaseConstruct).toContain('createDbUserBundleDir:');
    expect(databaseConstruct).toContain("framework: 'sqlmodel'");
    expect(databaseConstruct).not.toContain('createDbUserImageCommand');
    expect(
      tree.read('packages/db/proj_db/create_db_user_handler.py', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/constructs/src/core/rdb/aurora.ts', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should generate MySQL dependencies and templates', async () => {
    await pyRdbGenerator(tree, { ...defaultOptions, engine: 'mysql' });

    const pyproject = tree.read('packages/db/pyproject.toml', 'utf-8');
    expect(pyproject).toContain('pymysql==1.2.0');
    expect(pyproject).not.toContain('psycopg[binary,pool]');
    expect(
      tree.read('packages/db/proj_db/connection.py', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/db/proj_db/migration_handler.py', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/db/proj_db/create_db_user_handler.py', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/db/Dockerfile.migration', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/db/Dockerfile.create-db-user', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should generate Terraform modules', async () => {
    await pyRdbGenerator(tree, { ...defaultOptions, iac: 'terraform' });

    expect(
      tree.read('packages/common/terraform/src/app/dbs/db/db.tf', 'utf-8'),
    ).toMatchSnapshot();
    const projectConfig = readProjectConfigurationUnqualified(tree, 'proj.db');
    expect(projectConfig.targets.docker).toEqual({
      cache: true,
      executor: 'nx:run-commands',
      options: {
        commands: [
          'docker build --platform linux/arm64 --provenance=false -t proj-db-migration:latest dist/packages/db/docker/migration',
          'docker build --platform linux/arm64 --provenance=false -t proj-db-create-db-user:latest dist/packages/db/docker/create-db-user',
        ],
        parallel: false,
      },
      dependsOn: ['bundle-migration', 'bundle-create-db-user'],
    });
    expect(projectConfig.targets.build.dependsOn).toContain('docker');
  });

  it('should generate local database support without infrastructure', async () => {
    await pyRdbGenerator(tree, { ...defaultOptions, infra: 'none' });

    const projectConfig = readProjectConfigurationUnqualified(tree, 'proj.db');
    expect(projectConfig.targets['bundle-migration']).toBeUndefined();
    expect(projectConfig.targets['bundle-create-db-user']).toBeUndefined();
    expect(projectConfig.targets['dev']).toBeDefined();
    expect(projectConfig.targets.migrate).toBeDefined();
    expect(tree.exists('packages/common/constructs')).toBe(false);
  });

  it('should be idempotent and support adding infrastructure later', async () => {
    await pyRdbGenerator(tree, { ...defaultOptions, infra: 'none' });
    await pyRdbGenerator(tree, defaultOptions);
    await pyRdbGenerator(tree, defaultOptions);

    const projectConfig = readProjectConfigurationUnqualified(tree, 'proj.db');
    expect(projectConfig.metadata?.ports).toHaveLength(1);
    expect(projectConfig.targets['bundle-migration']).toBeDefined();
    expect(projectConfig.targets['bundle-create-db-user']).toBeDefined();
    const sharedConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    expect(
      sharedConfig.targets.build.dependsOn.filter(
        (dependency: string) => dependency === 'proj.db:build',
      ),
    ).toHaveLength(1);
  });

  it('should add generator metrics', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });
    await pyRdbGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, PY_RDB_GENERATOR_INFO.metric);
  });
});
