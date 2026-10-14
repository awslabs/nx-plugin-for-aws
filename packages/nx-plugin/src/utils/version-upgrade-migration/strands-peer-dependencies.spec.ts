/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  getProjects,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { agentcoreGatewayGenerator } from '../../agentcore-gateway/generator.js';
import { tsAgentA2aConnectionGenerator } from '../../ts/agent/a2a-connection/generator.js';
import { tsAgentGatewayConnectionGenerator } from '../../ts/agent/gateway-connection/generator.js';
import { tsAgentGenerator } from '../../ts/agent/generator.js';
import { tsAgentMcpConnectionGenerator } from '../../ts/agent/mcp-connection/generator.js';
import { tsAstroDocsGenerator } from '../../ts/astro-docs/generator.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';

const STRANDS_SDK = '@strands-agents/sdk';
/**
 * The peers of `@strands-agents/sdk` that are also vended in
 * `versions.ts` and reachable at a floating version via a transitive
 * dependency or pnpm's peer auto-install (see `STRANDS_PEER_DEPENDENCY_NAMES` in
 * `agent-connection.ts` for the full explanation). Any package.json that
 * declares strands without also declaring these splits `@strands-agents/sdk`
 * into two peer-suffixed pnpm instances.
 */
const REQUIRED_STRANDS_PEERS = [
  'express',
  '@aws-sdk/client-s3',
  '@modelcontextprotocol/client',
] as const;

/** `ts#agent` declares `@aws-sdk/client-s3` only for its `session: 's3'`
 * branch (the only branch that actually uses S3), so the in-memory session
 * branch is a deliberate, tested exception to the client-s3 peer rule — see
 * `generator.spec.ts`'s "should not add the @aws-sdk/client-s3 dependency
 * when session is in-memory". The guard below checks that project's
 * package.json against express only. */
const EXEMPT_FROM_CLIENT_S3 = 'apps/http-agent-in-memory/package.json';

/**
 * Every `dependencies` key across every `package.json` in the tree (the
 * project manifests plus the workspace root), so the guard sees exactly what
 * a real `pnpm install` would resolve against.
 */
const allPackageJsons = (tree: Tree): Map<string, Record<string, unknown>> => {
  const found = new Map<string, Record<string, unknown>>();
  found.set('package.json', readJson(tree, 'package.json'));
  for (const project of getProjects(tree).values()) {
    const path = `${project.root}/package.json`;
    if (tree.exists(path)) {
      found.set(path, readJson(tree, path));
    }
  }
  return found;
};

/**
 * Every package.json in the tree that declares `@strands-agents/sdk` but is
 * missing one of its required peers — the exact shape that splits the SDK
 * into two peer-suffixed pnpm instances and fails `compile` with
 * TS2322/TS2345.
 */
const strandsPeerViolations = (tree: Tree): string[] => {
  const violations: string[] = [];
  for (const [path, packageJson] of allPackageJsons(tree)) {
    const deps = (packageJson.dependencies ?? {}) as Record<string, unknown>;
    if (!(STRANDS_SDK in deps)) {
      continue;
    }
    for (const peer of REQUIRED_STRANDS_PEERS) {
      if (peer === '@aws-sdk/client-s3' && path === EXEMPT_FROM_CLIENT_S3) {
        continue;
      }
      if (!(peer in deps)) {
        violations.push(`${path}: declares ${STRANDS_SDK} without ${peer}`);
      }
    }
  }
  return violations;
};

/** Minimal agent.ts every connection generator's AST transform expects. */
const AGENT_TS = `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) =>
  new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [multiply],
  });
`;

/**
 * `ts#agent` adds its agent to an existing TypeScript project rather than
 * creating one, so each protocol/branch under test needs its own bare host
 * project first (mirrors `ts/agent/generator.spec.ts`'s `beforeEach`).
 */
const addHostProject = (tree: Tree, name: string): void => {
  addProjectConfiguration(tree, name, {
    root: `apps/${name}`,
    sourceRoot: `apps/${name}/src`,
    targets: {},
  });
  writeJson(tree, `apps/${name}/tsconfig.json`, {});
  writeJson(tree, `apps/${name}/package.json`, { name, version: '0.0.0' });
};

/**
 * One workspace holding every generator/configuration that declares
 * `@strands-agents/sdk`: the four `ts#agent` protocols (one of which is the
 * `session: in-memory` exemption above), each of the three connection
 * generators, and `ts#astro-docs` with translation on.
 */
const buildWorkspaceWithEveryStrandsImporter = async (
  tree: Tree,
): Promise<void> => {
  for (const name of [
    'http-agent',
    'http-agent-in-memory',
    'ag-ui-agent',
    'a2a-agent',
    'remote-agent',
  ]) {
    addHostProject(tree, name);
  }

  // ts#agent, one project per protocol (http is the default and also covers
  // the a2a-connection / mcp-connection / gateway-connection source project).
  await tsAgentGenerator(tree, {
    project: 'http-agent',
    name: 'agent',
    infra: 'none',
    iac: 'cdk',
  });
  await tsAgentGenerator(tree, {
    project: 'http-agent-in-memory',
    name: 'agent',
    infra: 'none',
    session: 'in-memory',
    iac: 'cdk',
  });
  await tsAgentGenerator(tree, {
    project: 'ag-ui-agent',
    name: 'agent',
    protocol: 'ag-ui',
    infra: 'none',
    iac: 'cdk',
  });
  await tsAgentGenerator(tree, {
    project: 'a2a-agent',
    name: 'agent',
    protocol: 'a2a',
    infra: 'none',
    iac: 'cdk',
  });

  // A second a2a-protocol agent to be the a2a-connection's target.
  await tsAgentGenerator(tree, {
    project: 'remote-agent',
    name: 'agent',
    protocol: 'a2a',
    infra: 'none',
    iac: 'cdk',
  });

  tree.write('apps/http-agent/src/agent/agent.ts', AGENT_TS);

  await tsAgentA2aConnectionGenerator(tree, {
    sourceProject: 'http-agent',
    targetProject: 'remote-agent',
    sourceComponent: {
      generator: 'ts#agent',
      name: 'agent',
      path: 'src/agent',
      port: 8081,
      rc: 'Agent',
      auth: 'iam',
      protocol: 'http',
    },
    targetComponent: {
      generator: 'ts#agent',
      name: 'agent',
      path: 'src/agent',
      port: 9000,
      rc: 'RemoteAgent',
      auth: 'iam',
      protocol: 'a2a',
    },
  });

  await tsAgentMcpConnectionGenerator(tree, {
    sourceProject: 'http-agent',
    targetProject: 'http-agent',
    sourceComponent: {
      generator: 'ts#agent',
      name: 'agent',
      path: 'src/agent',
      port: 8081,
    },
    targetComponent: {
      generator: 'ts#mcp-server',
      name: 'inventory-mcp',
      path: 'src/inventory-mcp',
      port: 8082,
      rc: 'InventoryMcp',
    },
  });

  await agentcoreGatewayGenerator(tree, { name: 'my-gateway', iac: 'cdk' });

  await tsAgentGatewayConnectionGenerator(tree, {
    sourceProject: 'http-agent',
    targetProject: 'my-gateway',
    sourceComponent: {
      generator: 'ts#agent',
      name: 'agent',
      path: 'src/agent',
      port: 8081,
    },
  });

  await tsAstroDocsGenerator(tree, { name: 'docs' });
};

describe('strands peer dependency guard', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  // Generates a real workspace with every generator/configuration that
  // declares @strands-agents/sdk and checks every package.json in the tree,
  // rather than grepping generator source — a future strands importer this
  // test predates still gets checked, since it checks the generated output,
  // not a fixed list of generator ids.
  it('should declare every required peer alongside @strands-agents/sdk in every generated package.json', async () => {
    await buildWorkspaceWithEveryStrandsImporter(tree);

    expect(strandsPeerViolations(tree)).toEqual([]);
  });
});
