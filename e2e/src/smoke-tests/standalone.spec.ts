/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { describe, it } from 'vitest';
import { SUPPORTED_CONNECTIONS } from '../../../packages/nx-plugin/src/connection/supported-connections';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

/**
 * Verifies that every generator builds in isolation, so a project generator
 * that forgets a dependency is caught here rather than being masked by another
 * generator happening to add it in a shared workspace.
 *
 * Project and component generator cases are derived from `generators.json`, so
 * new generators are picked up automatically. Each runs with default arguments,
 * supplying only the required `name` / `project` we control. Generators with
 * other unsatisfiable required arguments (e.g. `connection`, which needs a
 * source and target project) are skipped here and instead covered by the
 * connection matrix below, derived from `SUPPORTED_CONNECTIONS`.
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

// Optional sharding across machines: set NX_E2E_SHARD=<index>/<total> (1-based)
// to run only a slice of the cases, mirroring the unit-test shards. Cases are
// distributed round-robin (via a cursor shared across all three groups in
// source order) so heavy Python/agent cases spread evenly rather than clumping
// into one shard. Discovery stays programmatic — only the run is split, so
// coverage still evolves automatically. Defaults to 1/1 (run everything).
//
// Each case runs a full `nx run-many --target build --all`, which already
// parallelises across the machine's cores. Cases therefore run sequentially
// (a plain `describe`, not `describe.concurrent`): overlapping them would
// multiply into an N×cores process storm that starves nx's plugin workers and
// inflates wall-clock. Parallelism comes from sharding across machines instead.
const [shardIndex, shardTotal] = (process.env.NX_E2E_SHARD ?? '1/1')
  .split('/')
  .map(Number);
let shardCursor = 0;
const forThisShard = <T>(cases: T[]): T[] =>
  cases.filter(() => shardCursor++ % shardTotal === shardIndex - 1);

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

// Each generator runs in its own isolated workspace and keeps the default
// dependency install, so the build still verifies each generator declares the
// dependencies it needs.
describe('smoke test - standalone projects', () => {
  it.each(
    forThisShard(standalone),
  )('should generate and build $generator in isolation', async ({
    generator,
    hasName,
  }) => {
    const cwd = await freshWorkspace(generator);
    await runCLI(
      `generate @aws/nx-plugin:${generator} ${hasName ? '--name=test' : ''} --no-interactive`,
      { cwd, env: { NX_DAEMON: 'false' } },
    );
    await syncAndBuild(cwd);
  });
});

describe('smoke test - standalone components', () => {
  it.each(
    forThisShard(components),
  )('should generate and build $generator on its own project', async ({
    generator,
    hasName,
  }) => {
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
  });
});

// How to reference an endpoint in a connection command: the project to pass as
// source/target, and (for component-typed endpoints) the component to select.
interface ConnectionEndpoint {
  project: string;
  component?: string;
}

// Builds the source/target projects a connection needs. Each endpoint type maps
// to the generator(s) that produce it, keyed by the same identifiers the
// connection generator resolves projects to. `suffix` disambiguates the two
// sides so a self-referential connection (e.g. ts#agent -> ts#agent) gets two
// distinct components. Each generator keeps its default dependency install so
// both the pnpm and uv lockfiles are synced before the build.
const ENDPOINT_BUILDERS: Record<
  string,
  (opts: { cwd: string }, suffix: string) => Promise<ConnectionEndpoint>
> = {
  'ts#react-website': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:ts#website --name=website-${s} --no-interactive`,
      opts,
    );
    return { project: `website-${s}` };
  },
  'ts#trpc-api': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:ts#api --framework=trpc --name=trpc-api-${s} --no-interactive`,
      opts,
    );
    return { project: `trpc-api-${s}` };
  },
  'ts#smithy-api': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:ts#api --framework=smithy --name=smithy-api-${s} --no-interactive`,
      opts,
    );
    return { project: `smithy-api-${s}` };
  },
  'py#fast-api': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:py#api --name=fast-api-${s} --no-interactive`,
      opts,
    );
    // Python projects are referenced by their unqualified snake_case name.
    return { project: `fast_api_${s}` };
  },
  'ts#rdb': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:ts#rdb --name=rdb-${s} --no-interactive`,
      opts,
    );
    return { project: `rdb-${s}` };
  },
  'ts#dynamodb': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:ts#dynamodb --name=ts-table-${s} --no-interactive`,
      opts,
    );
    return { project: `ts-table-${s}` };
  },
  'py#dynamodb': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:py#dynamodb --name=py-table-${s} --no-interactive`,
      opts,
    );
    return { project: `py_table_${s}` };
  },
  'agentcore-gateway': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:agentcore-gateway --name=gateway-${s} --no-interactive`,
      opts,
    );
    return { project: `gateway-${s}` };
  },
  'ts#agent': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=ts-host-${s} --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#agent --project=ts-host-${s} --name=agent-${s} --infra=none --no-interactive`,
      opts,
    );
    return { project: `ts-host-${s}`, component: `agent-${s}` };
  },
  'py#agent': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=py-host-${s} --projectType=application --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#agent --project=py_host_${s} --name=agent-${s} --infra=none --no-interactive`,
      opts,
    );
    return { project: `py_host_${s}`, component: `agent-${s}` };
  },
  'ts#mcp-server': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=ts-mcp-host-${s} --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:ts#mcp-server --project=ts-mcp-host-${s} --name=mcp-${s} --infra=none --no-interactive`,
      opts,
    );
    return { project: `ts-mcp-host-${s}`, component: `mcp-${s}` };
  },
  'py#mcp-server': async (opts, s) => {
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=py-mcp-host-${s} --projectType=application --no-interactive`,
      opts,
    );
    await runCLI(
      `generate @aws/nx-plugin:py#mcp-server --project=py_mcp_host_${s} --name=mcp-${s} --infra=none --no-interactive`,
      opts,
    );
    return { project: `py_mcp_host_${s}`, component: `mcp-${s}` };
  },
};

// Some agent connections require a specific target protocol. A2A agents connect
// as tools (agent -> agent), while a React website can only connect to an HTTP
// or AG-UI agent. Override the target agent's protocol per connection.
const TARGET_PROTOCOL_OVERRIDE: Record<string, 'a2a' | 'ag-ui' | 'http'> = {
  'ts#agent -> ts#agent': 'a2a',
  'ts#agent -> py#agent': 'a2a',
  'py#agent -> ts#agent': 'a2a',
  'py#agent -> py#agent': 'a2a',
};

const buildAgentEndpoint = async (
  type: string,
  opts: { cwd: string },
  suffix: string,
  protocol?: 'a2a' | 'ag-ui' | 'http',
): Promise<ConnectionEndpoint> => {
  if (!protocol) {
    return ENDPOINT_BUILDERS[type](opts, suffix);
  }
  const lang = type === 'py#agent' ? 'py' : 'ts';
  const hostGen = lang === 'py' ? 'py#project' : 'ts#project';
  const hostName = `${lang}-host-${suffix}`;
  const hostProject =
    lang === 'py' ? `py_host_${suffix}` : `${lang}-host-${suffix}`;
  await runCLI(
    `generate @aws/nx-plugin:${hostGen} --name=${hostName} ${lang === 'py' ? '--projectType=application ' : ''}--no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:${lang}#agent --project=${hostProject} --name=agent-${suffix} --protocol=${protocol} --infra=none --no-interactive`,
    opts,
  );
  return { project: hostProject, component: `agent-${suffix}` };
};

const connectionCases = SUPPORTED_CONNECTIONS.map((connection) => ({
  connection,
  key: `${connection.source} -> ${connection.target}`,
}));

// Exercises each supported connection end-to-end in its own isolated workspace:
// generate the source and target projects, run the connection generator, then
// sync and build. This complements the unit tests (which mock the underlying
// connection generators) by proving the real generators wire up projects that
// build. Cases are derived from SUPPORTED_CONNECTIONS so new connections are
// picked up automatically.
describe('smoke test - standalone connections', () => {
  it.each(
    forThisShard(connectionCases),
  )('should generate and build the $key connection', async ({
    connection,
    key,
  }) => {
    const cwd = await freshWorkspace(`connection-${key}`);
    const opts = { cwd, env: { NX_DAEMON: 'false' } };

    const targetProtocol = TARGET_PROTOCOL_OVERRIDE[key];

    const source =
      connection.source === 'ts#agent' || connection.source === 'py#agent'
        ? await buildAgentEndpoint(connection.source, opts, 'src')
        : await ENDPOINT_BUILDERS[connection.source](opts, 'src');
    const target =
      connection.target === 'ts#agent' || connection.target === 'py#agent'
        ? await buildAgentEndpoint(
            connection.target,
            opts,
            'tgt',
            targetProtocol,
          )
        : await ENDPOINT_BUILDERS[connection.target](opts, 'tgt');

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
  });
});
