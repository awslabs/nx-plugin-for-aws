/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { FsTree, flushChanges } from 'nx/src/generators/tree';
import { formatFilesInSubtree } from '../../../packages/nx-plugin/src/utils/format';

/**
 * Code the container-deploy smoke test adds to its generated workspace so
 * every deployed container connection is called. The connection generators
 * vend clients and grants, not calls, so the test writes the calls a user
 * would write:
 *
 * - both services get `GET /digest?message=...`, which returns the first 12
 *   hex characters of the message's SHA-256. Each agent gets one tool per
 *   service (`ts_service_digest`, `py_service_digest`) that calls this route
 *   through the vended client.
 * - both services get `PUT /items/<id>`, which writes one item to the
 *   service's DynamoDB table (`my-table` or `my-py-table`) and reads it back.
 * - both services get `PUT /rows/<value>`, which inserts one row through the
 *   service's rdb client (`postgres-db` or `py-postgres-db`) and selects it
 *   back by its new id.
 * - the `postgres-db` project gets a first Prisma migration. The rdb
 *   generators vend no migration, and the runtime database user may not
 *   create tables, so the deploy-time migration (run as the admin user)
 *   creates `ExampleTable` (the Prisma model) and `examplemodel` (the py#rdb
 *   SQLModel model; the Python service uses the same cluster, see
 *   `application-stack.ts.template`).
 *
 * The websites' calls (`GET /hello` and `GET /echo`) use the routes the
 * container generators vend, so need no code.
 *
 * Each edit inserts code at a line the generators vend and throws if that
 * line is missing, so a template change fails here rather than at deploy
 * time. The edited files are formatted with the plugin's own formatter
 * (biome and ruff, which also sorts imports), so the workspace's lint and
 * format checks pass on them.
 */
export const addContainerConnectionCalls = async (
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

  // TypeScript service: digest, DynamoDB item and database row routes.
  const tsServiceDir = 'packages/ts-project/src/ts-service';
  const esm = read(`${tsServiceDir}/index.ts`).includes("'./server.js'");
  if (!tree.exists(`${tsServiceDir}/postgres-db.ts`)) {
    throw new Error(
      `Generated ${tsServiceDir}/postgres-db.ts (the vended rdb client) not found`,
    );
  }
  edit(`${tsServiceDir}/server.ts`, [
    [
      'import {\n  createServer as createHttpServer,',
      `import { createHash } from 'node:crypto';
import {
  createServer as createHttpServer,`,
    ],
    [
      "} from 'node:http';",
      `} from 'node:http';
import { createExampleEntity } from '@e2e-test/my-table';
import { getPostgresDb } from './postgres-db${esm ? '.js' : ''}';`,
    ],
    [
      `  res.end(JSON.stringify(body));
};`,
      `  res.end(JSON.stringify(body));
};

// Writes one item to the MyTable table and reads it back.
const putAndGetItem = async (id: string) => {
  const entity = await createExampleEntity();
  await entity.put({ id }).go();
  const { data } = await entity.get({ id }).go();
  return data;
};

// Inserts one row into the PostgresDb database and selects it back by id.
const insertAndSelectRow = async (value: string) => {
  const prisma = await getPostgresDb();
  const { id } = await prisma.exampleTable.create({
    data: { column1: value, column2: 'container-deploy' },
  });
  const row = await prisma.exampleTable.findUniqueOrThrow({ where: { id } });
  return { id: row.id, value: row.column1 };
};

// Replies to a request with the result of an async write and read.
const jsonFrom = (res: ServerResponse, result: Promise<unknown>) => {
  result.then(
    (body) => json(res, 200, body),
    (error) => json(res, 500, { message: String(error) }),
  );
};`,
    ],
    [
      "    if (req.method === 'GET' && url.pathname === '/health') {",
      `    if (req.method === 'GET' && url.pathname === '/digest') {
      const message = url.searchParams.get('message') ?? '';
      const digest = createHash('sha256')
        .update(message)
        .digest('hex')
        .slice(0, 12);
      return json(res, 200, { digest });
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/items/')) {
      const id = decodeURIComponent(url.pathname.slice('/items/'.length));
      return jsonFrom(res, putAndGetItem(id));
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/rows/')) {
      const value = decodeURIComponent(url.pathname.slice('/rows/'.length));
      return jsonFrom(res, insertAndSelectRow(value));
    }

    if (req.method === 'GET' && url.pathname === '/health') {`,
    ],
  ]);

  // Python service: the same three routes.
  const rdbModule = basename(pyModuleDir('py_postgres_db'));
  const tableModule = basename(pyModuleDir('my_py_table'));
  edit(`${pyModuleDir('py_project')}/py_service/main.py`, [
    [
      /^import os$/m,
      `import hashlib
import os`,
    ],
    [
      /^from pydantic import BaseModel$/m,
      `from pydantic import BaseModel
from ${rdbModule}.connection import session_context
from ${rdbModule}.models.example import ExampleModel as ExampleRow
from ${tableModule}.entities.example import ExampleModel as ExampleItem`,
    ],
    [
      '\n\nif __name__ == "__main__":',
      `

class DigestOutput(BaseModel):
    digest: str


@app.get("/digest")
def digest(message: Annotated[str, Query(max_length=1024)]) -> DigestOutput:
    """The first 12 hex characters of the SHA-256 of the message."""
    return DigestOutput(digest=hashlib.sha256(message.encode()).hexdigest()[:12])


class ItemOutput(BaseModel):
    id: str


@app.put("/items/{item_id}")
def put_item(item_id: str) -> ItemOutput:
    """Writes one item to the MyPyTable table and reads it back."""
    ExampleItem.create(id=item_id, name=item_id, category="container-deploy")
    # The item's name holds its id, so the reply comes from the read.
    return ItemOutput(id=ExampleItem.get_by_id(item_id).name)


class RowOutput(BaseModel):
    id: int
    value: str


@app.put("/rows/{value}")
async def put_row(value: str) -> RowOutput:
    """Inserts one row into the database and selects it back by id."""
    async with session_context() as session:
        row = ExampleRow(name=value, description="container-deploy")
        session.add(row)
        await session.commit()
        await session.refresh(row)
        row_id = row.id
    # A new session, so the row is read from the database, not the session.
    async with session_context() as session:
        fetched = await session.get(ExampleRow, row_id)
    if fetched is None or fetched.id is None:
        raise RuntimeError(f"Row {row_id} was not found after insert")
    return RowOutput(id=fetched.id, value=fetched.name)


if __name__ == "__main__":`,
    ],
  ]);

  // TypeScript agent: one digest tool per service, through the vended
  // clients.
  edit('packages/ts-project/src/agent/agent.ts', [
    [
      `import {
  ModelErrorLoggingPlugin,
  ToolErrorLoggingPlugin,
} from '`,
      `import {
  ModelErrorLoggingPlugin,
  PyServiceClient,
  ToolErrorLoggingPlugin,
  TsServiceClient,
} from '`,
    ],
    [
      'export const getAgent = async () => {',
      `// Calls GET /digest on a container service through its vended client.
const digestTool = (
  name: string,
  serviceName: string,
  createClient: () => Promise<{
    fetch: (path: string) => Promise<Response>;
  }>,
) =>
  tool({
    name,
    description: \`Get the digest of a message from the \${serviceName} container service\`,
    inputSchema: z.object({ message: z.string() }),
    callback: async ({ message }) => {
      const client = await createClient();
      const response = await client.fetch(
        \`/digest?message=\${encodeURIComponent(message)}\`,
      );
      if (!response.ok) {
        throw new Error(\`\${serviceName} returned \${response.status}\`);
      }
      return ((await response.json()) as { digest: string }).digest;
    },
  });

const tsServiceDigest = digestTool('ts_service_digest', 'TsService', () =>
  TsServiceClient.create(),
);
const pyServiceDigest = digestTool('py_service_digest', 'PyService', () =>
  PyServiceClient.create(),
);

export const getAgent = async () => {`,
    ],
    [
      'tools: [multiply],',
      'tools: [multiply, tsServiceDigest, pyServiceDigest],',
    ],
  ]);

  // Python agent: the same two tools, through the vended getters.
  edit(`${pyModuleDir('py_agents')}/py_agent/agent.py`, [
    [
      /^from (\S+) import log_model_errors, log_tool_errors$/m,
      'from $1 import get_py_service_client, get_ts_service_client, log_model_errors, log_tool_errors',
    ],
    [
      /^AGENT_HOOKS:/m,
      `@tool
def ts_service_digest(message: str) -> str:
    """Get the digest of a message from the TsService container service."""
    with get_ts_service_client() as client:
        response = client.get("/digest", params={"message": message})
        response.raise_for_status()
        return response.json()["digest"]


@tool
def py_service_digest(message: str) -> str:
    """Get the digest of a message from the PyService container service."""
    with get_py_service_client() as client:
        response = client.get("/digest", params={"message": message})
        response.raise_for_status()
        return response.json()["digest"]


AGENT_HOOKS:`,
    ],
    [
      'tools=[subtract, current_time]',
      'tools=[subtract, current_time, ts_service_digest, py_service_digest]',
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
