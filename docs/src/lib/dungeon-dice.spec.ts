/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { App, CfnOutput, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fixtures = resolve(
  __dirname,
  '../../../e2e/src/files/dungeon-adventure/dice',
);
const source = readFileSync(resolve(fixtures, 'roll-dice.ts.template'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const fixtureModule = {
  exports: {} as {
    createDiceRoller: (...args: any[]) => (sides: number) => Promise<any>;
    diceSides: readonly number[];
  },
};
new Function('exports', 'require', compiled)(
  fixtureModule.exports,
  createRequire(import.meta.url),
);
const { createDiceRoller } = fixtureModule.exports;
const compiledRegistration = ts.transpileModule(
  readFileSync(resolve(fixtures, 'register-dice.ts.template'), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;

interface ShadowCommandInput {
  thingName: string;
  shadowName: string;
  payload?: Uint8Array;
}

function diceMcpServer(send = vi.fn()) {
  const createClient = vi.fn();
  class IoTDataPlaneClient {
    constructor(config: unknown) {
      createClient(config);
    }
    send = send;
  }
  class GetThingShadowCommand {
    constructor(readonly input: ShadowCommandInput) {}
  }
  class UpdateThingShadowCommand {
    constructor(readonly input: ShadowCommandInput) {}
  }
  const registrationModule = {
    exports: {} as { registerDiceTool: (server: McpServer) => void },
  };
  const require = createRequire(import.meta.url);
  new Function('exports', 'require', compiledRegistration)(
    registrationModule.exports,
    (id: string) => {
      if (id === '@aws-sdk/client-iot-data-plane') {
        return {
          IoTDataPlaneClient,
          GetThingShadowCommand,
          UpdateThingShadowCommand,
        };
      }
      if (id === './roll-dice.js') return fixtureModule.exports;
      return require(id);
    },
  );
  const server = new McpServer({ name: 'inventory', version: '1.0.0' });
  registrationModule.exports.registerDiceTool(server);
  server.registerTool('list-inventory', {}, async () => ({
    content: [{ type: 'text', text: 'sword' }],
  }));
  const client = new Client({ name: 'dice-test', version: '1.0.0' });
  return {
    server,
    client,
    createClient,
    send,
    async connect() {
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

function shadowDevice(respond = true) {
  let now = 1_000_000;
  const shadow: any = { version: 1, state: { desired: {}, reported: {} } };
  let rolls = 0;
  const updates: any[] = [];
  const transport = {
    read: async () => structuredClone(shadow),
    update: async (change: any) => {
      if (change.version !== shadow.version) throw new Error('VersionConflict');
      updates.push(structuredClone(change));
      shadow.version++;
      shadow.state.desired = change.state.desired;
      const command = change.state.desired.command;
      if (command && respond) {
        rolls++;
        shadow.version++;
        shadow.state.reported.result = {
          requestId: command.requestId,
          sides: command.sides,
          value: 17,
          rolledAt: 1001,
        };
      }
    },
  };
  return {
    transport,
    updates,
    get rolls() {
      return rolls;
    },
    get shadow() {
      return shadow;
    },
    roll: createDiceRoller(
      transport,
      () => now,
      async () => {
        now += 1000;
      },
    ),
  };
}

describe('Dungeon Greengrass dice tutorial', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const diceEnvironment = {
    DICE_THING_NAME: 'dungeon-dice',
    DICE_IOT_ENDPOINT: 'dice.iot.example.com',
    DICE_AWS_REGION: 'us-east-1',
  };

  it('grants the Inventory runtime access only to the exact named dice shadow', () => {
    class GreengrassArtifactBucket extends Construct {
      readonly bucket = { bucketName: 'dice-artifacts' };
      grantReadTo() {}
    }
    class Dice extends Construct {
      readonly cfnComponentVersion = { attrArn: 'dice-component' };
    }
    class GreengrassDeployment extends Construct {
      readonly deployment = { attrDeploymentId: 'dice-deployment' };
      addComponent() {}
    }
    const fixture = ts.transpileModule(
      readFileSync(resolve(fixtures, 'dice-resources.ts.template'), 'utf8'),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText;
    const fixtureModule = {
      exports: {} as {
        DiceResources: new (
          scope: Construct,
          id: string,
        ) => {
          environmentVariables: Record<string, string>;
          grantShadowAccess(grantee: Role): void;
        };
      },
    };
    const require = createRequire(import.meta.url);
    new Function('exports', 'require', fixture)(
      fixtureModule.exports,
      (id: string) =>
        id === '@dungeon-adventure/common-constructs'
          ? { Dice, GreengrassArtifactBucket, GreengrassDeployment }
          : require(id),
    );
    const stack = new Stack(new App(), 'DiceShadow');
    const role = new Role(stack, 'InventoryRole', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    const dice = new fixtureModule.exports.DiceResources(stack, 'Dice');
    dice.grantShadowAccess(role);
    new CfnOutput(stack, 'ConfiguredEndpoint', {
      value: dice.environmentVariables.DICE_IOT_ENDPOINT,
    });
    const policies = Object.values<{
      Properties: { PolicyDocument: { Statement: unknown[] } };
    }>(Template.fromStack(stack).findResources('AWS::IAM::Policy'));
    const statements = policies.flatMap(
      (policy) => policy.Properties.PolicyDocument.Statement,
    );
    expect(statements).toEqual([
      {
        Effect: 'Allow',
        Action: ['iot:GetThingShadow', 'iot:UpdateThingShadow'],
        Resource: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iot:',
              { Ref: 'AWS::Region' },
              ':',
              { Ref: 'AWS::AccountId' },
              ':thing/',
              { Ref: 'DiceThingName' },
              '/dungeon-dice',
            ],
          ],
        },
      },
    ]);
  });

  it.each<[string, Partial<typeof diceEnvironment>]>([
    ['all configuration', {}],
    ['thing name', { ...diceEnvironment, DICE_THING_NAME: '' }],
    ['endpoint', { ...diceEnvironment, DICE_IOT_ENDPOINT: '' }],
    ['region', { ...diceEnvironment, DICE_AWS_REGION: '' }],
  ])('serves Inventory when dice is missing %s', async (_name, environment) => {
    for (const name of Object.keys(diceEnvironment) as Array<
      keyof typeof diceEnvironment
    >) {
      vi.stubEnv(name, environment[name]);
    }
    const mcp = diceMcpServer();
    try {
      await mcp.connect();
      const tools = await mcp.client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'roll-dice',
        'list-inventory',
      ]);
      const inventory = await mcp.client.callTool({
        name: 'list-inventory',
      });
      expect(inventory).toMatchObject({
        content: [{ type: 'text', text: 'sword' }],
      });
      const dice = CallToolResultSchema.parse(
        await mcp.client.callTool({
          name: 'roll-dice',
          arguments: { sides: 20 },
        }),
      );
      expect(dice).toEqual({
        isError: true,
        content: [
          {
            type: 'text',
            text: expect.stringContaining('The dice tool is not configured.'),
          },
        ],
      });
      for (const name of Object.keys(diceEnvironment)) {
        expect(dice.content[0]).toMatchObject({
          text: expect.stringContaining(name),
        });
      }
      expect(await mcp.client.callTool({ name: 'list-inventory' })).toEqual(
        inventory,
      );
      expect(mcp.createClient).not.toHaveBeenCalled();
      expect(mcp.send).not.toHaveBeenCalled();
    } finally {
      await mcp.close();
    }
  });

  it('routes a configured MCP roll through the dice shadow and returns its result', async () => {
    for (const [name, value] of Object.entries(diceEnvironment)) {
      vi.stubEnv(name, value);
    }
    const device = shadowDevice();
    const send = vi.fn(
      async (
        command: { input: ShadowCommandInput },
        options: { abortSignal: AbortSignal },
      ) => {
        expect(command.input).toMatchObject({
          thingName: 'dungeon-dice',
          shadowName: 'dungeon-dice',
        });
        expect(options.abortSignal).toBeInstanceOf(AbortSignal);
        if (command.input.payload) {
          await device.transport.update(
            JSON.parse(new TextDecoder().decode(command.input.payload)),
          );
          return {};
        }
        return {
          payload: new TextEncoder().encode(
            JSON.stringify(await device.transport.read()),
          ),
        };
      },
    );
    const mcp = diceMcpServer(send);
    try {
      await mcp.connect();
      expect(mcp.createClient).not.toHaveBeenCalled();
      const result = CallToolResultSchema.parse(
        await mcp.client.callTool({
          name: 'roll-dice',
          arguments: { sides: 20 },
        }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0]).toMatchObject({
        type: 'text',
        text: expect.any(String),
      });
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
        requestId: device.updates[0].state.desired.command.requestId,
        sides: 20,
        value: 17,
        rolledAt: 1001,
        device: 'dungeon-dice',
      });
      expect(mcp.createClient).toHaveBeenCalledExactlyOnceWith({
        region: 'us-east-1',
        endpoint: 'https://dice.iot.example.com',
        maxAttempts: 2,
      });
      expect(device.rolls).toBe(1);
      expect(device.shadow.state.desired.command).toBeNull();
    } finally {
      await mcp.close();
    }
  });

  it('returns the device result and releases its own request slot', async () => {
    const device = shadowDevice();
    const result = await device.roll(20);
    expect(result.value).toBe(17);
    expect(result.requestId).toBe(
      device.updates[0].state.desired.command.requestId,
    );
    expect(device.shadow.state.desired.command).toBeNull();
    expect(device.rolls).toBe(1);
  });

  it('rejects an unsupported die before contacting the device', async () => {
    const device = shadowDevice();
    await expect(device.roll(7)).rejects.toThrow('Choose');
    expect(device.updates).toHaveLength(0);
  });

  it('prevents simultaneous tools from replacing each other', async () => {
    const device = shadowDevice();
    const results = await Promise.allSettled([
      device.roll(20),
      device.roll(20),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(device.rolls).toBe(1);
  });

  it('refuses a busy device, including a completed request not yet collected', async () => {
    const device = shadowDevice();
    device.shadow.state.desired.command = {
      requestId: 'another',
      expiresAt: 1100,
    };
    await expect(device.roll(20)).rejects.toThrow('busy');
    expect(device.updates).toHaveLength(0);
  });

  it('allows a request after the old slot expires', async () => {
    const device = shadowDevice();
    device.shadow.state.desired.command = {
      requestId: 'expired',
      expiresAt: 999,
    };
    await expect(device.roll(20)).resolves.toMatchObject({ value: 17 });
  });

  it('does not return an old result or fabricate one when offline', async () => {
    const device = shadowDevice(false);
    device.shadow.state.reported.result = {
      requestId: 'old',
      sides: 20,
      value: 20,
    };
    await expect(device.roll(20)).rejects.toThrow('did not respond');
    expect(device.updates).toHaveLength(1);
    expect(device.rolls).toBe(0);
  });

  it('rejects a correlated result outside the die range', async () => {
    const device = shadowDevice();
    await expect(device.roll(6)).rejects.toThrow('invalid dice result');
  });

  it('does not clear a newer command if the acknowledgement loses a version race', async () => {
    const device = shadowDevice();
    const update = device.transport.update;
    device.transport.update = async (change: any) => {
      if (change.state.desired.command === null) {
        device.shadow.version++;
        device.shadow.state.desired.command = {
          requestId: 'newer',
          expiresAt: 1100,
        };
      }
      return update(change);
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(device.roll(20)).resolves.toMatchObject({ value: 17 });
      expect(device.shadow.state.desired.command.requestId).toBe('newer');
    } finally {
      warning.mockRestore();
    }
  });

  it('runs the device tests for redelivery, restart, expiry and failed persistence', () => {
    const output = execFileSync(
      'uv',
      [
        'run',
        '--no-project',
        '--python',
        '3.14',
        'python',
        '-B',
        resolve(fixtures, 'test_dice.py.template'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          UV_PYTHON_PREFERENCE: 'system',
          DICE_MODULE_PATH: resolve(fixtures, 'main.py.template'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(output).toBe('');
  });
});
