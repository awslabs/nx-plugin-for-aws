/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { agentcoreGatewayGenerator } from '../sdk/agentcore-gateway';
import { connectionGenerator } from '../sdk/connection';
import { pyAgentGenerator, pyProjectGenerator } from '../sdk/py';
import { tsAgentGenerator, tsProjectGenerator } from '../sdk/ts';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { CONNECTION_CONSTRAINTS } from './scaffold-catalog';

/**
 * `CONNECTION_CONSTRAINTS` exists so a caller choosing options up front — the
 * docs graph builder — can check them before emitting commands. That only holds
 * while each entry matches the guard its connection generator actually
 * enforces, and the drift is invisible to a test that reads the catalog alone:
 * a missing entry lets the builder emit a command that throws, and a stale
 * entry makes it reject a topology that works.
 *
 * These tests pin the two agent/gateway rules by running the generators, so
 * either kind of drift fails here.
 */
describe('catalog guard parity', () => {
  const setup = async (): Promise<Tree> => {
    const tree = createTreeUsingTsSolutionSetup();
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { iac: { provider: 'cdk' } });
    await tsProjectGenerator(tree, {
      name: 'ts-host',
      directory: 'packages',
      preferInstallDependencies: false,
    });
    await pyProjectGenerator(tree, {
      name: 'py-host',
      directory: 'packages',
      type: 'application',
      preferInstallDependencies: false,
    });
    return tree;
  };

  const gateway = (tree: Tree, name: string, protocol: string, auth: string) =>
    agentcoreGatewayGenerator(tree, {
      name,
      directory: 'packages',
      protocol: protocol as never,
      auth: auth as never,
      cedarPolicy: false,
      infra: 'agentcore',
      iac: 'inherit',
      preferInstallDependencies: false,
    });

  const tsAgent = (tree: Tree, name: string, protocol: string, auth: string) =>
    tsAgentGenerator(tree, {
      project: 'ts-host',
      name,
      framework: 'strands',
      protocol: protocol as never,
      auth: auth as never,
      infra: 'agentcore',
      session: 'in-memory',
      iac: 'inherit',
      preferInstallDependencies: false,
    });

  const pyAgent = (tree: Tree, name: string, protocol: string, auth: string) =>
    pyAgentGenerator(tree, {
      project: 'py_host',
      name,
      framework: 'strands',
      protocol: protocol as never,
      auth: auth as never,
      infra: 'agentcore',
      session: 'in-memory',
      iac: 'inherit',
      preferInstallDependencies: false,
    });

  const constraintsFor = (key: string) =>
    (CONNECTION_CONSTRAINTS as Record<string, readonly any[]>)[key] ?? [];

  describe('agent -> gateway requires an mcp gateway', () => {
    // The generators reject a non-mcp gateway, so the catalog has to say so —
    // otherwise the builder emits a command that dies after creating projects.
    it.each([
      ['ts#agent -> agentcore-gateway'],
      ['py#agent -> agentcore-gateway'],
    ])('is declared for %s', (key) => {
      expect(constraintsFor(key)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            side: 'target',
            option: 'protocol',
            equals: 'mcp',
          }),
        ]),
      );
    });

    it('is enforced by the ts#agent generator', async () => {
      const tree = await setup();
      await tsAgent(tree, 'tool-agent', 'ag-ui', 'iam');
      await gateway(tree, 'http-gw', 'http', 'iam');

      await expect(
        connectionGenerator(tree, {
          sourceProject: 'ts-host',
          sourceComponent: 'tool-agent',
          targetProject: 'http-gw',
          preferInstallDependencies: false,
        }),
      ).rejects.toThrow(/Only MCP-protocol gateways are supported/);
    });

    it('is enforced by the py#agent generator', async () => {
      const tree = await setup();
      await pyAgent(tree, 'tool-agent', 'ag-ui', 'iam');
      await gateway(tree, 'http-gw', 'http', 'iam');

      await expect(
        connectionGenerator(tree, {
          sourceProject: 'py_host',
          sourceComponent: 'tool-agent',
          targetProject: 'http-gw',
          preferInstallDependencies: false,
        }),
      ).rejects.toThrow(/Only MCP-protocol gateways are supported/);
    });
  });

  describe('gateway -> agent accepts a cognito agent', () => {
    // A gateway fronts a cognito agent by forwarding the caller's JWT, so
    // pinning the agent to IAM would rule out a topology that works.
    it.each([
      ['agentcore-gateway -> ts#agent'],
      ['agentcore-gateway -> py#agent'],
    ])('is not constrained to iam for %s', (key) => {
      expect(
        constraintsFor(key).filter(
          (c) => c.side === 'target' && c.option === 'auth',
        ),
      ).toEqual([]);
    });

    it('connects a cognito ts#agent behind a gateway', async () => {
      const tree = await setup();
      await gateway(tree, 'http-gw', 'http', 'iam');
      await tsAgent(tree, 'cog-agent', 'ag-ui', 'cognito');

      await expect(
        connectionGenerator(tree, {
          sourceProject: 'http-gw',
          targetProject: 'ts-host',
          targetComponent: 'cog-agent',
          preferInstallDependencies: false,
        }),
      ).resolves.toBeDefined();
    });

    it('connects a cognito py#agent behind a gateway', async () => {
      const tree = await setup();
      await gateway(tree, 'http-gw', 'http', 'iam');
      await pyAgent(tree, 'cog-agent', 'ag-ui', 'cognito');

      await expect(
        connectionGenerator(tree, {
          sourceProject: 'http-gw',
          targetProject: 'py_host',
          targetComponent: 'cog-agent',
          preferInstallDependencies: false,
        }),
      ).resolves.toBeDefined();
    });
  });
});
