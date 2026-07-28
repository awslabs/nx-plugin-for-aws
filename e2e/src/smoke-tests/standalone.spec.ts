/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { describe, it } from 'vitest';
import type { ConnectionKey } from '../../../packages/nx-plugin/src/connection/supported-connections';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

/**
 * Verifies every generator builds in isolation, catching a generator that
 * forgets a dependency masked by another in a shared workspace. Project and
 * component cases derive from `generators.json`; connection cases from the
 * typed CONNECTION_CASES map below.
 */

const PLUGIN_ROOT = join(__dirname, '../../../packages/nx-plugin');

// Required arguments this test supplies itself; any other required argument
// must have a schema default for the generator to be exercised here.
const SATISFIABLE_ARGS = new Set(['name', 'project']);

// Component generators that attach to a specific kind of project rather than a
// plain ts#project / py#project.
const COMPONENT_BASE_OVERRIDES: Record<string, string> = {
  'ts#website#auth': 'ts#website',
};

interface GeneratorCase {
  generator: string;
  hasName: boolean;
}

const readSchema = (
  schemaPath: string,
): {
  required?: string[];
  properties?: Record<string, { default?: unknown }>;
} => JSON.parse(readFileSync(join(PLUGIN_ROOT, schemaPath), 'utf-8'));

const categorizeGenerators = () => {
  const { generators } = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, 'generators.json'), 'utf-8'),
  ) as {
    generators: Record<string, { schema: string; hidden?: boolean }>;
  };

  const standalone: GeneratorCase[] = [];
  const components: GeneratorCase[] = [];

  for (const [generator, config] of Object.entries(generators)) {
    if (config.hidden) {
      continue;
    }
    const schema = readSchema(config.schema);
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];

    // Skip generators with required arguments we can neither supply nor
    // default (e.g. connection generators needing existing projects).
    const hasUnsatisfiableArgs = required.some(
      (arg) =>
        !SATISFIABLE_ARGS.has(arg) && !('default' in (properties[arg] ?? {})),
    );
    if (hasUnsatisfiableArgs) {
      continue;
    }

    const generatorCase: GeneratorCase = {
      generator,
      hasName: 'name' in properties,
    };
    (required.includes('project') ? components : standalone).push(
      generatorCase,
    );
  }

  return { standalone, components };
};

const { standalone, components } = categorizeGenerators();

// The CodeBuild Windows runner lacks Docker (agents, MCP servers and rdb build a
// Docker image) and can't run checkov (ts#infra and terraform#project). These
// stay covered on the Linux standalone leg and the windows-latest
// dungeon-adventure test.
const CODEBUILD_WINDOWS = process.env.NX_E2E_CODEBUILD_WINDOWS === 'true';

const CODEBUILD_WINDOWS_UNSUPPORTED = new Set([
  'ts#agent',
  'py#agent',
  'ts#mcp-server',
  'py#mcp-server',
  'ts#rdb',
  'py#rdb',
  'ts#infra',
  'terraform#project',
]);

// A connection is unsupported when either endpoint's project is. Matched exactly
// against each side of the key.
const CONNECTION_UNSUPPORTED_ENDPOINTS = new Set([
  'ts#agent',
  'py#agent',
  'ts#mcp-server',
  'py#mcp-server',
  'ts#smithy-api',
  'ts#rdb',
  'py#rdb',
]);

const connectionUnsupported = (key: string): boolean =>
  key
    .split('->')
    .map((side) => side.trim())
    .some((endpoint) => CONNECTION_UNSUPPORTED_ENDPOINTS.has(endpoint));

const keepForRunner = <T extends { generator?: string; unsupported?: boolean }>(
  cases: T[],
): T[] =>
  CODEBUILD_WINDOWS
    ? cases.filter(
        (c) =>
          !c.unsupported &&
          !(c.generator && CODEBUILD_WINDOWS_UNSUPPORTED.has(c.generator)),
      )
    : cases;

// Optional cross-machine sharding via NX_E2E_SHARD=<index>/<total> (1-based),
// round-robin across a cursor shared by all groups in source order. Cases run
// sequentially within a shard (each build already saturates the cores);
// parallelism comes from sharding. Defaults to 1/1 (everything).
const [shardIndex, shardTotal] = (process.env.NX_E2E_SHARD ?? '1/1')
  .split('/')
  .map(Number);
let shardCursor = 0;
const forThisShard = <T>(cases: T[]): T[] =>
  cases.filter(() => shardCursor++ % shardTotal === shardIndex - 1);

// Sliced per group; a group can be empty for a shard, so its describe is
// skipped to avoid vitest's empty-`it.each` error. Unsupported cases are dropped
// first (on the CodeBuild Windows runner) so the remainder shards evenly.
const shardStandalone = forThisShard(keepForRunner(standalone));
const shardComponents = forThisShard(keepForRunner(components));

const freshWorkspace = async (generator: string): Promise<string> => {
  const targetDir = join(
    tmpProjPath(),
    `standalone-${generator.replace(/[^a-z0-9]+/gi, '-')}`,
  );
  console.log(`Cleaning target directory ${targetDir}`);
  if (existsSync(targetDir)) {
    rmSync(targetDir, { force: true, recursive: true });
  }
  ensureDirSync(targetDir);
  return createTestWorkspace('pnpm', targetDir, 'proj', 'cdk');
};

const syncAndBuild = async (cwd: string) => {
  const opts = { cwd, env: { NX_DAEMON: 'false' } };
  await runCLI(`sync --verbose`, opts);
  await runCLI(
    `run-many --target build --all --output-style=stream --verbose`,
    opts,
  );
};

describe.skipIf(shardStandalone.length === 0)(
  'smoke test - standalone projects',
  () => {
    it.each(shardStandalone)(
      'should generate and build $generator in isolation',
      async ({ generator, hasName }) => {
        const cwd = await freshWorkspace(generator);
        await runCLI(
          `generate @aws/nx-plugin:${generator} ${hasName ? '--name=test' : ''} --no-interactive`,
          { cwd, env: { NX_DAEMON: 'false' } },
        );
        await syncAndBuild(cwd);
      },
    );
  },
);

describe.skipIf(shardComponents.length === 0)(
  'smoke test - standalone components',
  () => {
    it.each(shardComponents)(
      'should generate and build $generator on its own project',
      async ({ generator, hasName }) => {
        const cwd = await freshWorkspace(generator);
        const opts = { cwd, env: { NX_DAEMON: 'false' } };

        const baseGenerator =
          COMPONENT_BASE_OVERRIDES[generator] ??
          (generator.startsWith('py') ? 'py#project' : 'ts#project');

        await runCLI(
          `generate @aws/nx-plugin:${baseGenerator} --name=base --no-interactive`,
          opts,
        );
        await runCLI(
          `generate @aws/nx-plugin:${generator} --project=base ${hasName ? '--name=test' : ''} --no-interactive`,
          opts,
        );
        await syncAndBuild(cwd);
      },
    );
  },
);

// How to reference one side of a connection in the `connection` command.
type Side = { project: string; component?: string };
type Opts = { cwd: string };

// Generates a connection's source and target projects, returning how to
// reference each side. Multiple per connection enumerate variants (e.g.
// agent protocols).
type CaseFactory = (opts: Opts) => Promise<{ source: Side; target: Side }>;

// Endpoint builders, keyed by the identifier the connection generator resolves
// a project to. `s` disambiguates the two sides of a self-connection.
const website = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:ts#website --name=website-${s} --no-interactive`,
    opts,
  );
  return { project: `website-${s}` };
};
const trpcApi = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:ts#api --framework=trpc --name=trpc-api-${s} --no-interactive`,
    opts,
  );
  return { project: `trpc-api-${s}` };
};
const smithyApi = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:ts#api --framework=smithy --name=smithy-api-${s} --no-interactive`,
    opts,
  );
  return { project: `smithy-api-${s}` };
};
// Python projects are referenced by their unqualified snake_case name.
const fastApi = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=fast-api-${s} --no-interactive`,
    opts,
  );
  return { project: `fast_api_${s}` };
};
const rdb = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:ts#rdb --name=rdb-${s} --no-interactive`,
    opts,
  );
  return { project: `rdb-${s}` };
};
const pyRdb = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:py#rdb --name=py-rdb-${s} --framework=sqlmodel --no-interactive`,
    opts,
  );
  return { project: `py_rdb_${s}` };
};
const tsDynamodb = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:ts#dynamodb --name=ts-table-${s} --no-interactive`,
    opts,
  );
  return { project: `ts-table-${s}` };
};
const pyDynamodb = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:py#dynamodb --name=py-table-${s} --no-interactive`,
    opts,
  );
  return { project: `py_table_${s}` };
};
const gateway = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:agentcore-gateway --name=gateway-${s} --no-interactive`,
    opts,
  );
  return { project: `gateway-${s}` };
};
const tsAgent = async (
  opts: Opts,
  s: string,
  protocol = 'http',
): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-host-${s} --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-host-${s} --name=agent-${s} --protocol=${protocol} --infra=none --no-interactive`,
    opts,
  );
  return { project: `ts-host-${s}`, component: `agent-${s}` };
};
const pyAgent = async (
  opts: Opts,
  s: string,
  protocol = 'http',
): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-host-${s} --projectType=application --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_host_${s} --name=agent-${s} --protocol=${protocol} --infra=none --no-interactive`,
    opts,
  );
  return { project: `py_host_${s}`, component: `agent-${s}` };
};
const tsMcp = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-mcp-host-${s} --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-mcp-host-${s} --name=mcp-${s} --infra=none --no-interactive`,
    opts,
  );
  return { project: `ts-mcp-host-${s}`, component: `mcp-${s}` };
};
const pyMcp = async (opts: Opts, s: string): Promise<Side> => {
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-mcp-host-${s} --projectType=application --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#mcp-server --project=py_mcp_host_${s} --name=mcp-${s} --infra=none --no-interactive`,
    opts,
  );
  return { project: `py_mcp_host_${s}`, component: `mcp-${s}` };
};

// Compose a factory from a source and target builder.
const pair =
  (
    src: (opts: Opts, s: string) => Promise<Side>,
    tgt: (opts: Opts, s: string) => Promise<Side>,
  ): CaseFactory =>
  async (opts) => ({
    source: await src(opts, 'src'),
    target: await tgt(opts, 'tgt'),
  });

// Every supported connection maps to one or more case factories. Keyed by
// ConnectionKey via `satisfies`, so adding a connection without a case here is
// a compile error. Agent-to-agent connections use A2A targets (agents connect
// as tools); a React website connects to HTTP or AG-UI agents.
const CONNECTION_CASES = {
  'ts#trpc-api -> ts#rdb': [pair(trpcApi, rdb)],
  'ts#trpc-api -> ts#dynamodb': [pair(trpcApi, tsDynamodb)],
  'ts#agent -> ts#rdb': [pair(tsAgent, rdb)],
  'ts#smithy-api -> ts#rdb': [pair(smithyApi, rdb)],
  'ts#smithy-api -> ts#dynamodb': [pair(smithyApi, tsDynamodb)],
  'ts#mcp-server -> ts#rdb': [pair(tsMcp, rdb)],
  'ts#mcp-server -> ts#dynamodb': [pair(tsMcp, tsDynamodb)],
  'ts#react-website -> ts#trpc-api': [pair(website, trpcApi)],
  'ts#react-website -> py#fast-api': [pair(website, fastApi)],
  'ts#react-website -> ts#smithy-api': [pair(website, smithyApi)],
  'ts#react-website -> ts#agent': [
    pair(website, (o, s) => tsAgent(o, s, 'http')),
    pair(website, (o, s) => tsAgent(o, s, 'ag-ui')),
  ],
  'ts#react-website -> py#agent': [
    pair(website, (o, s) => pyAgent(o, s, 'http')),
    pair(website, (o, s) => pyAgent(o, s, 'ag-ui')),
  ],
  'ts#agent -> ts#mcp-server': [pair(tsAgent, tsMcp)],
  'ts#agent -> py#mcp-server': [pair(tsAgent, pyMcp)],
  'ts#agent -> ts#dynamodb': [pair(tsAgent, tsDynamodb)],
  'py#agent -> ts#mcp-server': [pair(pyAgent, tsMcp)],
  'py#agent -> py#mcp-server': [pair(pyAgent, pyMcp)],
  'ts#agent -> ts#agent': [pair(tsAgent, (o, s) => tsAgent(o, s, 'a2a'))],
  'ts#agent -> py#agent': [pair(tsAgent, (o, s) => pyAgent(o, s, 'a2a'))],
  'py#agent -> ts#agent': [pair(pyAgent, (o, s) => tsAgent(o, s, 'a2a'))],
  'py#agent -> py#agent': [pair(pyAgent, (o, s) => pyAgent(o, s, 'a2a'))],
  'ts#agent -> agentcore-gateway': [pair(tsAgent, gateway)],
  'py#agent -> agentcore-gateway': [pair(pyAgent, gateway)],
  'agentcore-gateway -> ts#mcp-server': [pair(gateway, tsMcp)],
  'agentcore-gateway -> py#mcp-server': [pair(gateway, pyMcp)],
  'agentcore-gateway -> agentcore-gateway': [pair(gateway, gateway)],
  'py#fast-api -> py#dynamodb': [pair(fastApi, pyDynamodb)],
  'py#agent -> py#dynamodb': [pair(pyAgent, pyDynamodb)],
  'py#mcp-server -> py#dynamodb': [pair(pyMcp, pyDynamodb)],
  'py#fast-api -> py#rdb': [pair(fastApi, pyRdb)],
  'py#agent -> py#rdb': [pair(pyAgent, pyRdb)],
  'py#mcp-server -> py#rdb': [pair(pyMcp, pyRdb)],
} satisfies Record<ConnectionKey, CaseFactory[]>;

// Flatten to one case per factory, labelling variants when a connection has
// more than one.
const connectionCases = Object.entries(CONNECTION_CASES).flatMap(
  ([key, factories]) =>
    factories.map((factory, i) => ({
      key: factories.length > 1 ? `${key} #${i + 1}` : key,
      factory,
      unsupported: connectionUnsupported(key),
    })),
);
const shardConnectionCases = forThisShard(keepForRunner(connectionCases));

// Exercises each supported connection end-to-end (the unit tests mock the
// underlying connection generators; this proves they wire up buildable projects).
describe.skipIf(shardConnectionCases.length === 0)(
  'smoke test - standalone connections',
  () => {
    it.each(shardConnectionCases)(
      'should generate and build the $key connection',
      async ({ key, factory }) => {
        const cwd = await freshWorkspace(`connection-${key}`);
        const opts = { cwd, env: { NX_DAEMON: 'false' } };

        const { source, target } = await factory(opts);

        const sourceComponent = source.component
          ? ` --sourceComponent=${source.component}`
          : '';
        const targetComponent = target.component
          ? ` --targetComponent=${target.component}`
          : '';
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=${source.project} --targetProject=${target.project}${sourceComponent}${targetComponent} --no-interactive`,
          opts,
        );

        await syncAndBuild(cwd);
      },
    );
  },
);
