/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { resolveContainers } from '../../utils/containers.js';
import { expectHasMetricTags } from '../../utils/metrics.spec.js';
import { readProjectConfigurationUnqualified } from '../../utils/nx.js';
import { sharedConstructsGenerator } from '../../utils/shared-constructs.js';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test.js';
import {
  CONTAINER_VERSIONS,
  LAMBDA_RUNTIME_VERSIONS,
  withPyVersions,
} from '../../utils/versions.js';
import {
  DEPENDENCIES,
  PY_RDB_GENERATOR_INFO,
  pyRdbGenerator,
} from './generator.js';

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
    framework: 'sqlmodel' as const,
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

    expect(pyproject).toContain(withPyVersions(DEPENDENCIES, ['sqlmodel'])[0]);
    expect(pyproject).toContain(withPyVersions(DEPENDENCIES, ['alembic'])[0]);
    expect(pyproject).toContain(withPyVersions(DEPENDENCIES, ['asyncpg'])[0]);
    expect(pyproject).not.toContain('psycopg');

    // A wildcard import raises F403, not F401, so suppressing F401 as well is
    // dead — and ruff's own RUF100 rule reports it as unused.
    expect(tree.read('packages/db/migrations/env.py', 'utf-8')).toContain(
      'import *  # noqa: F403',
    );

    expect(projectConfig.targets['bundle-arm']).toEqual({
      cache: true,
      inputs: ['production', '^production'],
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle-arm'],
      options: {
        commands: [
          'uv export --frozen --no-dev --no-editable --project {projectRoot} --package proj.db -o dist/{projectRoot}/bundle-arm/requirements.txt',
          `uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux_2_28 --python-version ${LAMBDA_RUNTIME_VERSIONS.python} --target dist/{projectRoot}/bundle-arm -r dist/{projectRoot}/bundle-arm/requirements.txt`,
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
    expect(databaseConstruct).toContain('createDbUserBundleDir = path.join(');
    expect(databaseConstruct).toContain(
      'DockerImageCode.fromImageAsset(createDbUserBundleDir',
    );
    expect(databaseConstruct).not.toContain('NODE_EXTRA_CA_CERTS');
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
    expect(pyproject).toContain(withPyVersions(DEPENDENCIES, ['aiomysql'])[0]);
    expect(pyproject).not.toContain('asyncpg');
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

    // Check that a cacheable trivy scan target was added covering both images
    expect(projectConfig.targets.trivy).toEqual({
      cache: true,
      inputs: ['default', '^production'],
      outputs: [
        '{workspaceRoot}/dist/packages/db/trivy/proj-db-migration-latest',
      ],
      executor: 'nx:run-commands',
      options: {
        commands: [
          'rimraf dist/packages/db/trivy/proj-db-migration-latest',
          'make-dir dist/packages/db/trivy/proj-db-migration-latest',
          'ncp packages/db/.trivyignore dist/packages/db/trivy/proj-db-migration-latest/.trivyignore',
          'docker save -o dist/packages/db/trivy/proj-db-migration-latest/image-0.tar proj-db-migration:latest',
          `docker run --rm -v "./dist/packages/db/trivy/proj-db-migration-latest":/scan public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy} image --input /scan/image-0.tar --ignorefile /scan/.trivyignore --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress -q`,
          'docker save -o dist/packages/db/trivy/proj-db-migration-latest/image-1.tar proj-db-create-db-user:latest',
          `docker run --rm -v "./dist/packages/db/trivy/proj-db-migration-latest":/scan public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy} image --input /scan/image-1.tar --ignorefile /scan/.trivyignore --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress -q`,
        ],
        parallel: false,
      },
      dependsOn: ['docker'],
    });
    // Trivy is not wired into build (its result depends on the vulnerability DB).
    expect(projectConfig.targets.build.dependsOn ?? []).not.toContain('trivy');
  });

  it('should generate local database support without infrastructure', async () => {
    await pyRdbGenerator(tree, { ...defaultOptions, infra: 'none' });

    const projectConfig = readProjectConfigurationUnqualified(tree, 'proj.db');
    expect(projectConfig.targets['bundle-migration']).toBeUndefined();
    expect(projectConfig.targets['bundle-create-db-user']).toBeUndefined();
    expect(projectConfig.targets.dev).toBeDefined();
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

  // Re-running must not destroy the schema and edits the user owns — the whole
  // point of re-running is usually to add infrastructure to an existing project.
  it('should preserve user edits to user-owned files on a re-run', async () => {
    await pyRdbGenerator(tree, { ...defaultOptions, infra: 'none' });

    const userOwned = {
      'packages/db/proj_db/models/example.py': `class MyModel(SQLModel, table=True):
    critical_business_field: str
`,
      'packages/db/proj_db/connection.py': '# user edited connection\n',
      'packages/db/proj_db/utils.py': '# user edited utils\n',
      'packages/db/alembic.ini': '# user edited alembic config\n',
      'packages/db/migrations/env.py': '# user edited migration env\n',
    };
    for (const [path, contents] of Object.entries(userOwned)) {
      expect(tree.exists(path)).toBe(true);
      tree.write(path, contents);
    }

    await pyRdbGenerator(tree, defaultOptions);

    for (const [path, contents] of Object.entries(userOwned)) {
      expect(tree.read(path, 'utf-8')).toBe(contents);
    }
  });

  // config.json is framework-owned, so changed options must land on a re-run.
  it('should converge framework-owned files on a re-run with changed options', async () => {
    await pyRdbGenerator(tree, { ...defaultOptions, engine: 'postgres' });
    await pyRdbGenerator(tree, { ...defaultOptions, engine: 'mysql' });

    const config = JSON.parse(
      tree.read('packages/db/config.json', 'utf-8') ?? '{}',
    );
    expect(config.localDev.dbEngine).toBe('mysql');
    expect(tree.read('packages/db/proj_db/__init__.py', 'utf-8')).toContain(
      'from .connection import',
    );
  });

  it('should add generator metrics', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' }, DEPENDENCIES);
    await pyRdbGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, PY_RDB_GENERATOR_INFO.metric);
  });
});
