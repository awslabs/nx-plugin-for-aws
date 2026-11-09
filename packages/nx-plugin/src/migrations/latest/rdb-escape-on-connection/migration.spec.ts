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
  TS_RDB_GENERATOR_INFO,
  tsRdbGenerator,
} from '../../../ts/rdb/generator.js';
import { resolveContainers } from '../../../utils/containers.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

vi.mock('../../../utils/containers', () => ({
  resolveContainers: vi.fn(),
}));

const HANDLER = 'packages/db/src/create-db-user-handler.ts';

const tsRdbProject = (): ProjectConfiguration => ({
  name: 'db',
  root: 'packages/db',
  metadata: { generator: TS_RDB_GENERATOR_INFO.id } as any,
});

/** The pool escape declarations as the generator wrote them before. */
const OLD_ESCAPES = `  const quotedDbName = pool.escapeId(dbname);
  const quotedUser = pool.escape(dbUser);
  const quotedHost = pool.escape('%');

`;

/** The connection escape declarations the generator writes today. */
const NEW_ESCAPES = `    // Escape on the open connection, which knows the session's escaping mode
    const quotedDbName = connection.escapeId(dbname);
    const quotedUser = connection.escape(dbUser);
    const quotedHost = connection.escape('%');
`;

const LET_CONNECTION = '  let connection: PoolConnection | undefined;\n';
const GET_CONNECTION = '    connection = await pool.getConnection();\n';

/** A minimal MySQL handler with the pre-change escaping. */
const OLD_HANDLER = `import { createPool, type PoolConnection } from 'mariadb';

export const ensureDatabaseUser = async (
  dbname: string,
  dbUser: string,
): Promise<void> => {
  const pool = createPool({ connectionLimit: 1 });

${OLD_ESCAPES}${LET_CONNECTION}
  try {
${GET_CONNECTION}    await connection.query(
      \`CREATE USER IF NOT EXISTS \${quotedUser}@\${quotedHost}; GRANT ALL ON \${quotedDbName}.* TO \${quotedUser}@\${quotedHost}\`,
    );
  } finally {
    await connection?.release();
    await pool.end();
  }
};
`;

/** {@link OLD_HANDLER} after the migration. */
const NEW_HANDLER = `import { createPool, type PoolConnection } from 'mariadb';

export const ensureDatabaseUser = async (
  dbname: string,
  dbUser: string,
): Promise<void> => {
  const pool = createPool({ connectionLimit: 1 });

${LET_CONNECTION}
  try {
${GET_CONNECTION}${NEW_ESCAPES}    await connection.query(
      \`CREATE USER IF NOT EXISTS \${quotedUser}@\${quotedHost}; GRANT ALL ON \${quotedDbName}.* TO \${quotedUser}@\${quotedHost}\`,
    );
  } finally {
    await connection?.release();
    await pool.end();
  }
};
`;

const generateRdb = (tree: Tree, engine: 'mysql' | 'postgres') =>
  tsRdbGenerator(tree, {
    name: 'db',
    directory: 'packages',
    infra: 'aurora',
    engine,
    databaseUser: 'databaseUser',
    databaseName: 'databaseName',
    framework: 'prisma',
    iac: 'cdk',
  } as any);

describe('rdb-escape-on-connection migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(resolveContainers).mockResolvedValue('docker');
  });

  it('should move the escaping onto the open connection', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());
    tree.write(HANDLER, OLD_HANDLER);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(HANDLER, 'utf-8')).toBe(NEW_HANDLER);
  });

  it('should converge a generated workspace on exactly what the generator vends today', async () => {
    await generateRdb(tree, 'mysql');

    const vended = tree.read(HANDLER, 'utf-8');
    expect(vended).toContain(NEW_ESCAPES);
    expect(vended).not.toContain('pool.escape');

    // Roll the handler back to the shape a workspace generated before this
    // change would have, then confirm the migration restores it exactly.
    const rolledBack = vended
      .replace(NEW_ESCAPES, '')
      .replace(LET_CONNECTION, `${OLD_ESCAPES}${LET_CONNECTION}`);
    expect(rolledBack).toContain(OLD_ESCAPES);
    tree.write(HANDLER, rolledBack);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(HANDLER, 'utf-8')).toBe(vended);
  });

  it('should be a no-op on a freshly generated MySQL workspace', async () => {
    await generateRdb(tree, 'mysql');
    const before = tree.read(HANDLER, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(HANDLER, 'utf-8')).toBe(before);
  });

  it('should be a no-op on a Postgres workspace', async () => {
    await generateRdb(tree, 'postgres');
    const before = tree.read(HANDLER, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(HANDLER, 'utf-8')).toBe(before);
  });

  it('should be idempotent on re-run', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());
    tree.write(HANDLER, OLD_HANDLER);

    await migration(tree);
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(HANDLER, 'utf-8')).toBe(NEW_HANDLER);
  });

  it('should leave a customised handler untouched and report it', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());
    const customised = OLD_HANDLER.replace(
      "const quotedHost = pool.escape('%');",
      "const quotedHost = pool.escape('10.0.%');\n  const quotedRole = pool.escape('app_role');",
    );
    tree.write(HANDLER, customised);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(HANDLER);
    expect(tree.read(HANDLER, 'utf-8')).toBe(customised);
  });

  it('should report a handler whose pool escape arguments were edited', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());
    // Still exactly three pool escape calls, but the host no longer matches.
    const edited = OLD_HANDLER.replace(
      "const quotedHost = pool.escape('%');",
      "const quotedHost = pool.escape('10.0.%');",
    );
    tree.write(HANDLER, edited);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(HANDLER);
    expect(nextSteps[0]).toContain('pool.getConnection()');
    expect(tree.read(HANDLER, 'utf-8')).toBe(edited);
  });

  it('should report a handler that opens its connection differently', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());
    // The vended escape declarations, but no vended getConnection() call.
    const edited = OLD_HANDLER.replace(
      GET_CONNECTION,
      '    connection = await pool.getConnection({ timeout: 1000 });\n',
    );
    tree.write(HANDLER, edited);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(HANDLER);
    expect(tree.read(HANDLER, 'utf-8')).toBe(edited);
  });

  it('should skip a ts#rdb project without a create-db-user handler', async () => {
    addProjectConfiguration(tree, 'db', tsRdbProject());

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.exists(HANDLER)).toBe(false);
  });

  it('should be a no-op in a workspace without any ts#rdb project', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
  });

  it('should leave projects from other generators alone', async () => {
    addProjectConfiguration(tree, 'db', {
      ...tsRdbProject(),
      metadata: { generator: 'py#rdb' } as any,
    });
    tree.write(HANDLER, OLD_HANDLER);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read(HANDLER, 'utf-8')).toBe(OLD_HANDLER);
  });
});
