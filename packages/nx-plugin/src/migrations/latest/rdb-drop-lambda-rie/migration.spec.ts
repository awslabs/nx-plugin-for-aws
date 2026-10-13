/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import {
  PY_RDB_GENERATOR_INFO,
  pyRdbGenerator,
} from '../../../py/rdb/generator.js';
import {
  TS_RDB_GENERATOR_INFO,
  tsRdbGenerator,
} from '../../../ts/rdb/generator.js';
import { resolveContainers } from '../../../utils/containers.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

vi.mock('../../../utils/containers', () => ({
  resolveContainers: vi.fn(),
}));

const TS_DOCKERFILE = 'packages/db/Dockerfile';
const PY_MIGRATION_DOCKERFILE = 'packages/db/Dockerfile.migration';
const PY_CREATE_DB_USER_DOCKERFILE = 'packages/db/Dockerfile.create-db-user';

const tsRdbProject = (): ProjectConfiguration => ({
  name: 'db',
  root: 'packages/db',
  metadata: { generator: TS_RDB_GENERATOR_INFO.id } as any,
});

const pyRdbProject = (): ProjectConfiguration => ({
  name: 'db',
  root: 'packages/db',
  metadata: { generator: PY_RDB_GENERATOR_INFO.id } as any,
});

/** The ts#rdb Dockerfile's upgrade block, before and after this migration. */
const TS_OLD = `# Patch OS packages beyond the base image's pinned release, and drop the
# runtime's convenience copy of the AWS SDK (the handler bundle inlines its
# own dependencies), keeping the image free of known HIGH/CRITICAL
# vulnerabilities
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/runtime/node_modules/@aws-sdk`;
const TS_NEW = `# Patch OS packages beyond the base image's pinned release, and drop the
# runtime's convenience copy of the AWS SDK (the handler bundle inlines its
# own dependencies), keeping the image free of known HIGH/CRITICAL
# vulnerabilities. Also drop the Lambda Runtime Interface Emulator: it is only
# used for local \`docker run\` emulation outside Lambda, never by the deployed
# function, and carries known HIGH vulnerabilities.
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/runtime/node_modules/@aws-sdk /usr/local/bin/aws-lambda-rie`;

/** The py#rdb Dockerfiles' shared upgrade block, before and after this migration. */
const PY_OLD = `# Patch OS packages beyond the base image's pinned release, and drop pip, whose
# vendored copies of msgpack and setuptools carry known HIGH vulnerabilities.
# The handler's dependencies are already installed in the image, so nothing
# installs packages at runtime.
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/lang/lib/python*/site-packages/pip \\
    /var/lang/lib/python*/site-packages/pip-*.dist-info`;
const PY_NEW = `# Patch OS packages beyond the base image's pinned release, and drop pip, whose
# vendored copies of msgpack and setuptools carry known HIGH vulnerabilities.
# The handler's dependencies are already installed in the image, so nothing
# installs packages at runtime. Also drop the Lambda Runtime Interface
# Emulator: it is only used for local \`docker run\` emulation outside Lambda,
# never by the deployed function, and carries known HIGH vulnerabilities.
RUN microdnf upgrade -y --releasever latest && microdnf clean all \\
    && rm -rf /var/lang/lib/python*/site-packages/pip \\
    /var/lang/lib/python*/site-packages/pip-*.dist-info \\
    /usr/local/bin/aws-lambda-rie`;

const writeDockerfile = (
  tree: Tree,
  path: string,
  upgradeBlock: string,
): void =>
  tree.write(path, `FROM public.ecr.aws/lambda/nodejs:24\n\n${upgradeBlock}\n`);

describe('rdb-drop-lambda-rie migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(resolveContainers).mockResolvedValue('docker');
  });

  describe('ts#rdb', () => {
    it('should drop the RIE from the Dockerfile', async () => {
      addProjectConfiguration(tree, 'db', tsRdbProject());
      writeDockerfile(tree, TS_DOCKERFILE, TS_OLD);

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toHaveLength(0);
      expect(tree.read(TS_DOCKERFILE, 'utf-8')).toBe(
        `FROM public.ecr.aws/lambda/nodejs:24\n\n${TS_NEW}\n`,
      );
    });

    it('should converge a generated workspace on exactly what the generator vends today', async () => {
      await tsRdbGenerator(tree, {
        name: 'db',
        directory: 'packages',
        infra: 'aurora',
        engine: 'postgres',
        databaseUser: 'databaseUser',
        databaseName: 'databaseName',
        framework: 'prisma',
        iac: 'cdk',
      } as any);

      const vended = tree.read(TS_DOCKERFILE, 'utf-8');
      expect(vended).toContain('/usr/local/bin/aws-lambda-rie');

      // Roll the file back to the shape a workspace generated before this
      // change would have, then confirm the migration restores it exactly.
      tree.write(TS_DOCKERFILE, vended.replace(TS_NEW, TS_OLD));

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toHaveLength(0);
      expect(tree.read(TS_DOCKERFILE, 'utf-8')).toBe(vended);
    });
  });

  describe('py#rdb', () => {
    it('should drop the RIE from both Dockerfiles', async () => {
      addProjectConfiguration(tree, 'db', pyRdbProject());
      writeDockerfile(tree, PY_MIGRATION_DOCKERFILE, PY_OLD);
      writeDockerfile(tree, PY_CREATE_DB_USER_DOCKERFILE, PY_OLD);

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toHaveLength(0);
      expect(tree.read(PY_MIGRATION_DOCKERFILE, 'utf-8')).toBe(
        `FROM public.ecr.aws/lambda/nodejs:24\n\n${PY_NEW}\n`,
      );
      expect(tree.read(PY_CREATE_DB_USER_DOCKERFILE, 'utf-8')).toBe(
        `FROM public.ecr.aws/lambda/nodejs:24\n\n${PY_NEW}\n`,
      );
    });

    it('should converge a generated workspace on exactly what the generator vends today', async () => {
      await pyRdbGenerator(tree, {
        name: 'db',
        directory: 'packages',
        infra: 'aurora',
        engine: 'postgres',
        framework: 'sqlmodel',
        databaseUser: 'databaseUser',
        databaseName: 'databaseName',
        iac: 'cdk',
      } as any);

      const vendedMigration = tree.read(PY_MIGRATION_DOCKERFILE, 'utf-8');
      const vendedCreateDbUser = tree.read(
        PY_CREATE_DB_USER_DOCKERFILE,
        'utf-8',
      );
      expect(vendedMigration).toContain('/usr/local/bin/aws-lambda-rie');
      expect(vendedCreateDbUser).toContain('/usr/local/bin/aws-lambda-rie');

      // Roll both files back to the shape a workspace generated before this
      // change would have, then confirm the migration restores them exactly.
      tree.write(
        PY_MIGRATION_DOCKERFILE,
        vendedMigration.replace(PY_NEW, PY_OLD),
      );
      tree.write(
        PY_CREATE_DB_USER_DOCKERFILE,
        vendedCreateDbUser.replace(PY_NEW, PY_OLD),
      );

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toHaveLength(0);
      expect(tree.read(PY_MIGRATION_DOCKERFILE, 'utf-8')).toBe(vendedMigration);
      expect(tree.read(PY_CREATE_DB_USER_DOCKERFILE, 'utf-8')).toBe(
        vendedCreateDbUser,
      );
    });
  });

  it('should be a no-op on a freshly generated workspace', async () => {
    await tsRdbGenerator(tree, {
      name: 'db',
      directory: 'packages',
      infra: 'aurora',
      engine: 'postgres',
      databaseUser: 'databaseUser',
      databaseName: 'databaseName',
      framework: 'prisma',
      iac: 'cdk',
    } as any);
    const before = tree.read(TS_DOCKERFILE, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(TS_DOCKERFILE, 'utf-8')).toBe(before);
  });

  it('should be idempotent on re-run', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());
    writeDockerfile(tree, TS_DOCKERFILE, TS_OLD);

    await migration(tree);
    const afterFirstRun = tree.read(TS_DOCKERFILE, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(TS_DOCKERFILE, 'utf-8')).toBe(afterFirstRun);
  });

  it('should leave a diverged Dockerfile untouched and report it', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());
    const customised = `FROM public.ecr.aws/lambda/nodejs:24\n\n# Custom upgrade step\nRUN microdnf upgrade -y --releasever latest && microdnf clean all \\\n    && rm -rf /var/runtime/node_modules/@aws-sdk /opt/custom-tool\n`;
    tree.write(TS_DOCKERFILE, customised);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(TS_DOCKERFILE);
    expect(tree.read(TS_DOCKERFILE, 'utf-8')).toBe(customised);
  });

  it('should be a no-op in a workspace without any rdb project', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
  });

  it('should leave projects from other generators alone', async () => {
    addProjectConfiguration(tree, 'db', {
      name: 'db',
      root: 'packages/db',
      metadata: { generator: 'py#agent' } as any,
    });
    writeDockerfile(tree, TS_DOCKERFILE, TS_OLD);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(TS_DOCKERFILE, 'utf-8')).toBe(
      `FROM public.ecr.aws/lambda/nodejs:24\n\n${TS_OLD}\n`,
    );
  });
});
