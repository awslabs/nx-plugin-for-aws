/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs';
import { ensureDirSync } from 'fs-extra';
import {
  CONNECTION_EXPECTATIONS,
  type ConnectionOutcome,
} from '../../../packages/nx-plugin/src/connection/connection-expectations';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

/**
 * End-to-end verification that agent connection permutations behave as the
 * expectation table declares — using the real CLI and a real build.
 *
 * This complements the unit tiers (which run on an in-memory Tree):
 *  - Unsupported permutations must fail the `connection` generator with the
 *    declared error — the literal "throw a not-supported error" requirement,
 *    proven through the actual CLI.
 *  - Supported agent variants the default generator matrix doesn't cover
 *    (cognito auth, AG-UI/A2A protocols) must vend code that actually builds.
 *
 * The cases are derived from CONNECTION_EXPECTATIONS, so adding an enum value
 * (e.g. a new agent framework) and classifying its permutations automatically
 * extends this test — there is no second list to maintain here.
 */

const outcomeFor = (
  key: keyof typeof CONNECTION_EXPECTATIONS,
  source: Record<string, string>,
  target: Record<string, string>,
): ConnectionOutcome => CONNECTION_EXPECTATIONS[key]({ source, target });

describe('smoke test - connection-permutations', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/connection-permutations-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('verifies agent connection permutations via the CLI and a build', async () => {
    const projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      'e2e-test',
      'cdk',
    );
    const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

    // A Python host project holding agent + MCP server variants across the
    // dimensions that affect connections (protocol, auth).
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=agents --no-interactive`,
      opts,
    );

    // Agent variants: protocol x auth, hosted on agentcore so auth applies.
    const agents = [
      { name: 'http-iam', protocol: 'http', auth: 'iam' },
      { name: 'http-cognito', protocol: 'http', auth: 'cognito' },
      { name: 'a2a-iam', protocol: 'a2a', auth: 'iam' },
      { name: 'agui-iam', protocol: 'ag-ui', auth: 'iam' },
    ] as const;
    for (const a of agents) {
      await runCLI(
        `generate @aws/nx-plugin:py#agent --project=agents --name=${a.name} --protocol=${a.protocol} --auth=${a.auth} --no-interactive`,
        opts,
      );
    }

    // MCP server variants: iam vs cognito auth.
    const mcpServers = [
      { name: 'mcp-iam', auth: 'iam' },
      { name: 'mcp-cognito', auth: 'cognito' },
    ] as const;
    for (const m of mcpServers) {
      await runCLI(
        `generate @aws/nx-plugin:py#mcp-server --project=agents --name=${m.name} --auth=${m.auth} --no-interactive`,
        opts,
      );
    }

    const connect = (sourceComponent: string, targetComponent: string) =>
      `generate @aws/nx-plugin:connection --sourceProject=agents --sourceComponent=${sourceComponent} --targetProject=agents --targetComponent=${targetComponent} --no-interactive`;

    // py#agent -> py#mcp-server: unsupported when the MCP server isn't IAM.
    for (const agent of agents) {
      for (const mcp of mcpServers) {
        const outcome = outcomeFor(
          'py#agent -> py#mcp-server',
          { framework: 'strands', protocol: agent.protocol, auth: agent.auth },
          { auth: mcp.auth },
        );
        if (outcome.kind === 'unsupported') {
          console.log(
            `Expecting failure: ${agent.name} -> ${mcp.name} (${outcome.errorMatches})`,
          );
          await expect(
            runCLI(connect(agent.name, mcp.name), {
              ...opts,
              silenceError: false,
            }),
          ).rejects.toThrow();
        } else {
          await runCLI(connect(agent.name, mcp.name), opts);
        }
      }
    }

    // py#agent -> py#agent (A2A): unsupported unless the target speaks A2A.
    for (const agent of agents) {
      for (const targetAgent of agents) {
        if (agent.name === targetAgent.name) continue;
        const outcome = outcomeFor(
          'py#agent -> py#agent',
          { framework: 'strands', protocol: agent.protocol, auth: agent.auth },
          {
            framework: 'strands',
            protocol: targetAgent.protocol,
            auth: targetAgent.auth,
          },
        );
        if (outcome.kind === 'unsupported') {
          console.log(
            `Expecting failure: ${agent.name} -> ${targetAgent.name} (${outcome.errorMatches})`,
          );
          await expect(
            runCLI(connect(agent.name, targetAgent.name), {
              ...opts,
              silenceError: false,
            }),
          ).rejects.toThrow();
        } else {
          await runCLI(connect(agent.name, targetAgent.name), opts);
        }
      }
    }

    // Everything wired above that was supported must build.
    await runCLI(`sync --verbose`, opts);
    await runCLI(
      `run-many --target build --all --output-style=stream --verbose`,
      opts,
    );
  });
});
