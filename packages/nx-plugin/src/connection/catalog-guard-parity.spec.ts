/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { agentcoreGatewayGenerator } from '../sdk/agentcore-gateway';
import { connectionGenerator } from '../sdk/connection';
import {
  pyAgentGenerator,
  pyContainerGenerator,
  pyProjectGenerator,
} from '../sdk/py';
import {
  tsAgentGenerator,
  tsContainerGenerator,
  tsProjectGenerator,
  tsWebsiteGenerator,
} from '../sdk/ts';
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

  describe('gateway -> agent accepts a cognito agent behind a cognito gateway', () => {
    // A gateway fronts a cognito agent by forwarding the caller's JWT, so
    // pinning the agent to IAM would rule out a topology that works. The token
    // has to come from somewhere, though, so the gateway must be cognito too.
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

    it.each([
      ['agentcore-gateway -> ts#agent'],
      ['agentcore-gateway -> py#agent'],
    ])('requires a cognito gateway for a cognito agent in %s', (key) => {
      expect(constraintsFor(key)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            side: 'source',
            option: 'auth',
            equals: 'cognito',
            when: { side: 'target', option: 'auth', equals: 'cognito' },
          }),
        ]),
      );
    });

    it('connects a cognito ts#agent behind a cognito gateway', async () => {
      const tree = await setup();
      await gateway(tree, 'http-gw', 'http', 'cognito');
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

    it('connects a cognito py#agent behind a cognito gateway', async () => {
      const tree = await setup();
      await gateway(tree, 'http-gw', 'http', 'cognito');
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

    it('is enforced against an iam gateway', async () => {
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
      ).rejects.toThrow(/only a Cognito gateway receives/);
    });
  });

  describe('agent -> gateway accepts a cognito agent', () => {
    // The agent's auth governs inbound requests to it. Its outbound call to the
    // gateway is SigV4-signed from its execution role, so pinning it to IAM
    // would rule out a topology that works.
    it.each([
      ['ts#agent -> agentcore-gateway'],
      ['py#agent -> agentcore-gateway'],
    ])('is not constrained to iam for %s', (key) => {
      expect(
        constraintsFor(key).filter(
          (c) => c.side === 'source' && c.option === 'auth',
        ),
      ).toEqual([]);
    });

    it('connects a cognito ts#agent to a gateway', async () => {
      const tree = await setup();
      await tsAgent(tree, 'cog-agent', 'ag-ui', 'cognito');
      await gateway(tree, 'mcp-gw', 'mcp', 'iam');

      await expect(
        connectionGenerator(tree, {
          sourceProject: 'ts-host',
          sourceComponent: 'cog-agent',
          targetProject: 'mcp-gw',
          preferInstallDependencies: false,
        }),
      ).resolves.toBeDefined();
    });

    it('connects a cognito py#agent to a gateway', async () => {
      const tree = await setup();
      await pyAgent(tree, 'cog-agent', 'ag-ui', 'cognito');
      await gateway(tree, 'mcp-gw', 'mcp', 'iam');

      await expect(
        connectionGenerator(tree, {
          sourceProject: 'py_host',
          sourceComponent: 'cog-agent',
          targetProject: 'mcp-gw',
          preferInstallDependencies: false,
        }),
      ).resolves.toBeDefined();
    });
  });

  // Container services: each connection guard reads its catalog entry, and
  // these cases run the generators to show every constraint fires.
  const containerProjects = async (tree: Tree) => {
    await tsProjectGenerator(tree, {
      name: 'ts-svc',
      directory: 'packages',
      preferInstallDependencies: false,
    });
    await pyProjectGenerator(tree, {
      name: 'py-svc',
      directory: 'packages',
      type: 'application',
      preferInstallDependencies: false,
    });
  };

  const container = (
    tree: Tree,
    kind: 'ts' | 'py',
    name: string,
    options: { infra?: string; ingress?: string; auth?: string },
  ) =>
    (kind === 'ts' ? tsContainerGenerator : pyContainerGenerator)(tree, {
      project: kind === 'ts' ? 'ts-svc' : 'py_svc',
      name,
      infra: options.infra as never,
      ingress: options.ingress as never,
      auth: options.auth as never,
      iac: 'inherit',
      preferInstallDependencies: false,
    });

  const connectTo = (
    tree: Tree,
    kind: 'ts' | 'py',
    source: { sourceProject: string; sourceComponent?: string },
  ) =>
    connectionGenerator(tree, {
      ...source,
      targetProject: kind === 'ts' ? 'ts-svc' : 'py_svc',
      targetComponent: 'orders',
      preferInstallDependencies: false,
    });

  const reasonOf = (key: string, option: string) =>
    constraintsFor(key).find((c) => c.option === option)?.reason as string;

  describe('container callers', () => {
    const CALLERS = [
      ['ts#react-website -> ts#container', 'website', 'ts'],
      ['ts#react-website -> py#container', 'website', 'py'],
      ['ts#agent -> ts#container', 'ts-agent', 'ts'],
      ['ts#agent -> py#container', 'ts-agent', 'py'],
      ['py#agent -> ts#container', 'py-agent', 'ts'],
      ['py#agent -> py#container', 'py-agent', 'py'],
    ] as const;

    const callerSetup = async (caller: (typeof CALLERS)[number][1]) => {
      const tree = await setup();
      await containerProjects(tree);
      if (caller === 'website') {
        await tsWebsiteGenerator(tree, {
          name: 'website',
          framework: 'react',
          iac: 'inherit',
          preferInstallDependencies: false,
        });
        return { tree, source: { sourceProject: 'website' } };
      }
      if (caller === 'ts-agent') {
        await tsAgent(tree, 'caller', 'http', 'iam');
        return {
          tree,
          source: { sourceProject: 'ts-host', sourceComponent: 'caller' },
        };
      }
      await pyAgent(tree, 'caller', 'http', 'iam');
      return {
        tree,
        source: { sourceProject: 'py_host', sourceComponent: 'caller' },
      };
    };

    it.each(CALLERS)('declares the HTTP API constraints for %s', (key) => {
      expect(constraintsFor(key)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            side: 'target',
            option: 'infra',
            equals: 'ecs',
          }),
          expect.objectContaining({
            side: 'target',
            option: 'ingress',
            equals: 'http-api',
          }),
        ]),
      );
    });

    it.each(CALLERS)(
      'connects %s to an iam HTTP API service',
      async (_key, caller, kind) => {
        const { tree, source } = await callerSetup(caller);
        await container(tree, kind, 'orders', {});

        await expect(connectTo(tree, kind, source)).resolves.toBeDefined();
      },
    );

    it.each(CALLERS)(
      'rejects %s to a service with no infrastructure',
      async (key, caller, kind) => {
        const { tree, source } = await callerSetup(caller);
        await container(tree, kind, 'orders', { infra: 'none' });

        await expect(connectTo(tree, kind, source)).rejects.toThrow(
          reasonOf(key, 'infra'),
        );
      },
    );

    it.each(CALLERS)(
      'rejects %s to a private service',
      async (key, caller, kind) => {
        const { tree, source } = await callerSetup(caller);
        await container(tree, kind, 'orders', { ingress: 'private' });

        await expect(connectTo(tree, kind, source)).rejects.toThrow(
          reasonOf(key, 'ingress'),
        );
      },
    );

    it.each(
      CALLERS.filter(([, caller]) => caller !== 'website').flatMap(
        ([key, caller, kind]) =>
          (['cognito', 'none'] as const).map(
            (auth) => [key, caller, kind, auth] as const,
          ),
      ),
    )(
      'rejects %s to a service with %s auth',
      async (key, caller, kind, auth) => {
        const { tree, source } = await callerSetup(caller);
        await container(tree, kind, 'orders', { auth });

        await expect(connectTo(tree, kind, source)).rejects.toThrow(
          reasonOf(key, 'auth'),
        );
      },
    );

    it.each(['cognito', 'none'] as const)(
      'connects a website to a service with %s auth',
      async (auth) => {
        const { tree, source } = await callerSetup('website');
        await container(tree, 'ts', 'orders', { auth });

        await expect(connectTo(tree, 'ts', source)).resolves.toBeDefined();
      },
    );
  });
});
