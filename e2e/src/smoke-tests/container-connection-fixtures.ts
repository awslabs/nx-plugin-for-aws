/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FsTree, flushChanges } from 'nx/src/generators/tree';
import { formatFilesInSubtree } from '../../../packages/nx-plugin/src/utils/format';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../files/container-deploy', name), 'utf-8');

/**
 * Code the container-deploy smoke test adds to its generated workspace so
 * each deployed container service checks its own data connections. The
 * services have no inbound path, so the test cannot call them; instead each
 * service runs one round trip per connection when it starts and logs the
 * result, and the test reads the log (see `container-deploy-invocations.ts`).
 *
 * - `ts-service` gets `e2e-check.ts`, started from `index.ts` once the server
 *   listens. It writes and reads one item in `my-table`, and inserts and
 *   selects one row through the vended `postgres-db` client.
 * - `py-service` gets `e2e_check.py`, started from a FastAPI lifespan. It
 *   writes and reads one item in `my-py-table`, and inserts and selects one
 *   row through the vended `py-postgres-db` client.
 * - `ts-project` declares `@aws-lambda-powertools/parameters` and
 *   `@aws-sdk/client-appconfigdata`, which `e2e-check.ts` imports to wait for
 *   the database's runtime configuration, at the versions `postgres-db` uses.
 * - the `postgres-db` project gets a first Prisma migration. The rdb
 *   generators vend no migration, and the runtime database user may not
 *   create tables, so the deploy-time migration (run as the admin user)
 *   creates `ExampleTable` (the Prisma model) and `examplemodel` (the py#rdb
 *   SQLModel model; the Python service uses the same cluster, see
 *   `application-stack.ts.template`).
 *
 * Each check runs only when `E2E_CHECK_TOKEN` is set, which the deploy test
 * sets per run. Each edit inserts code at a line the generators vend and
 * throws if that line is missing, so a template change fails here rather
 * than at deploy time. The edited files are formatted with the plugin's own
 * formatter (biome and ruff, which also sorts imports), so the workspace's
 * lint and format checks pass on them.
 */
export const addContainerStartupChecks = async (
  projectRoot: string,
): Promise<void> => {
  const tree = new FsTree(projectRoot, false);
  const read = (path: string): string => {
    const content = tree.read(path, 'utf-8');
    if (content === null) {
      throw new Error(`Generated file not found: ${path}`);
    }
    return content;
  };
  const edit = (
    path: string,
    edits: [anchor: string | RegExp, by: string][],
  ) => {
    let content = read(path);
    for (const [anchor, by] of edits) {
      const matched =
        typeof anchor === 'string'
          ? content.includes(anchor)
          : anchor.test(content);
      if (!matched) {
        throw new Error(`Generated ${path} no longer contains ${anchor}`);
      }
      content = content.replace(anchor, by);
    }
    tree.write(path, content);
  };

  // A Python project's module directory, from its project.json.
  const pyModuleDir = (projectDir: string): string =>
    JSON.parse(
      readFileSync(
        join(projectRoot, 'packages', projectDir, 'project.json'),
        'utf-8',
      ),
    ).sourceRoot;

  // TypeScript service: the startup check, started once the server listens.
  const tsServiceDir = 'packages/ts-project/src/ts-service';
  const js = read(`${tsServiceDir}/index.ts`).includes("'./server.js'")
    ? '.js'
    : '';
  if (!tree.exists(`${tsServiceDir}/postgres-db.ts`)) {
    throw new Error(
      `Generated ${tsServiceDir}/postgres-db.ts (the vended rdb client) not found`,
    );
  }
  tree.write(
    `${tsServiceDir}/e2e-check.ts`,
    fixture('ts-service-e2e-check.ts.template').replace(/<% JS %>/g, js),
  );
  edit(`${tsServiceDir}/index.ts`, [
    [
      `import { createServer } from './server${js}';`,
      `import { describeError, runE2eChecks } from './e2e-check${js}';
import { createServer } from './server${js}';`,
    ],
    [
      /^( {2}console\.log\(`Listening on .*`\);)$/m,
      `$1
  // Logged, never rethrown: an unhandled rejection would exit the process and
  // the deployment would roll back as if the service itself had failed.
  void runE2eChecks().catch((error) => {
    console.error('E2E checks failed to start:', describeError(error));
  });`,
    ],
  ]);

  // e2e-check.ts reads runtime configuration with the same packages the
  // vended rdb client uses, so ts-project declares them at the same versions.
  const rdbDependencies = JSON.parse(read('packages/postgres-db/package.json'))
    .dependencies as Record<string, string> | undefined;
  const tsProjectPackageJsonPath = 'packages/ts-project/package.json';
  const tsProjectPackageJson = JSON.parse(read(tsProjectPackageJsonPath));
  for (const name of [
    '@aws-lambda-powertools/parameters',
    '@aws-sdk/client-appconfigdata',
  ]) {
    const version = rdbDependencies?.[name];
    if (!version) {
      throw new Error(
        `Generated packages/postgres-db/package.json no longer depends on ${name}`,
      );
    }
    tsProjectPackageJson.dependencies = {
      ...tsProjectPackageJson.dependencies,
      [name]: version,
    };
  }
  tree.write(
    tsProjectPackageJsonPath,
    `${JSON.stringify(tsProjectPackageJson, null, 2)}\n`,
  );

  // Python service: the startup check, started from the app's lifespan.
  const pyServiceDir = `${pyModuleDir('py_project')}/py_service`;
  const pyServiceModule = pyServiceDir.split('/').slice(-2).join('.');
  tree.write(
    `${pyServiceDir}/e2e_check.py`,
    fixture('py-service-e2e-check.py.template')
      .replace(/<% RDB_MODULE %>/g, basename(pyModuleDir('py_postgres_db')))
      .replace(/<% TABLE_MODULE %>/g, basename(pyModuleDir('my_py_table'))),
  );
  edit(`${pyServiceDir}/main.py`, [
    [
      /^from pydantic import BaseModel$/m,
      `from pydantic import BaseModel
from ${pyServiceModule}.e2e_check import e2e_check_lifespan`,
    ],
    [
      'app = FastAPI(title="PyService")',
      'app = FastAPI(title="PyService", lifespan=e2e_check_lifespan)',
    ],
  ]);

  // The rdb generators vend no migration. This is the first migration of the
  // shared database, in the format `prisma migrate dev` writes. The migration
  // Lambda bundles the project's prisma/ directory and runs
  // `prisma migrate deploy` at deploy time.
  const migrationsDir = 'packages/postgres-db/prisma/migrations';
  tree.write(
    `${migrationsDir}/migration_lock.toml`,
    `# Written by the container-deploy smoke test.
provider = "postgresql"
`,
  );
  tree.write(
    `${migrationsDir}/0_init/migration.sql`,
    `-- Written by the container-deploy smoke test.

-- CreateTable
CREATE TABLE "ExampleTable" (
    "id" SERIAL NOT NULL,
    "column1" TEXT NOT NULL,
    "column2" TEXT NOT NULL,

    CONSTRAINT "ExampleTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable: the py#rdb ExampleModel, used by the Python service.
CREATE TABLE "examplemodel" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "examplemodel_pkey" PRIMARY KEY ("id")
);
`,
  );

  await formatFilesInSubtree(tree);
  flushChanges(projectRoot, tree.listChanges());
};
