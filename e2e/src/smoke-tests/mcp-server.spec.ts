/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('smoke test - mcp-server', () => {
  it('should start the MCP server and respond to tool calls', async () => {
    // Start the MCP server using the exact command from the docs:
    //   npx -y @aws/nx-plugin-mcp
    // In e2e, the package is published to a local verdaccio registry
    // so we pass --registry to ensure npx fetches from it.
    const registry = process.env.npm_config_registry;
    const version = process.env.NX_E2E_PRESET_VERSION ?? 'latest';
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        ...(registry ? [`--registry=${registry}`] : []),
        `@aws/nx-plugin-mcp@${version}`,
      ],
      env: {
        ...process.env,
      },
    });

    const client = new Client({
      name: 'e2e-test-client',
      version: '1.0.0',
    });

    await client.connect(transport);

    try {
      // Verify the server exposes the expected tools
      const { tools } = await client.listTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('general-guidance');
      expect(toolNames).toContain('create-workspace-command');
      expect(toolNames).toContain('list-generators');
      expect(toolNames).toContain('generator-guide');

      // Every tool must have a description (required by Amazon Q CLI)
      for (const tool of tools) {
        expect(tool.description).toBeDefined();
      }

      // Test create-workspace-command
      const createResult = await client.callTool({
        name: 'create-workspace-command',
        arguments: { workspaceName: 'my-app', packageManager: 'pnpm' },
      });
      expect(createResult.content).toHaveLength(1);
      expect(createResult.isError).toBeFalsy();

      // Test list-generators
      const listResult = await client.callTool({
        name: 'list-generators',
        arguments: { packageManager: 'pnpm' },
      });
      expect((listResult.content[0] as { text: string }).text).toContain(
        'ts#project',
      );

      // Test generator-guide
      const guideResult = await client.callTool({
        name: 'generator-guide',
        arguments: { packageManager: 'pnpm', generator: 'ts#project' },
      });
      expect((guideResult.content[0] as { text: string }).text).toContain(
        'ts#project',
      );

      // Test general-guidance
      const guidanceResult = await client.callTool({
        name: 'general-guidance',
        arguments: {},
      });
      expect((guidanceResult.content[0] as { text: string }).text).toContain(
        'Nx Plugin for AWS',
      );
    } finally {
      await client.close();
    }
  });

  it('filters generator-guide output based on the supplied options', async () => {
    const registry = process.env.npm_config_registry;
    const version = process.env.NX_E2E_PRESET_VERSION ?? 'latest';
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        ...(registry ? [`--registry=${registry}`] : []),
        `@aws/nx-plugin-mcp@${version}`,
      ],
      env: { ...process.env },
    });

    const client = new Client({
      name: 'e2e-filter-test-client',
      version: '1.0.0',
    });
    await client.connect(transport);

    const callGuide = async (
      generator: string,
      options?: Record<string, string>,
    ): Promise<string> => {
      const result = await client.callTool({
        name: 'generator-guide',
        arguments: {
          packageManager: 'pnpm',
          generator,
          ...(options ? { options } : {}),
        },
      });
      return (result.content[0] as { text: string }).text;
    };

    try {
      // No options: OptionFilter blocks are kept with explicit markers so
      // the agent can see every branching condition.
      const noOptions = await callGuide('ts#trpc-api');
      expect(noOptions).toContain('> [!NOTE] Only when');

      // auth=Cognito: IAM-only identity middleware example is dropped, the
      // Cognito variant is inlined.
      const cognito = await callGuide('ts#trpc-api', { auth: 'Cognito' });
      expect(cognito).toContain('API Gateway Cognito User Pools authorizer');
      expect(cognito).not.toContain(
        'lookup the caller in Cognito using the sub',
      );
      // Auth-independent sections remain.
      expect(cognito).toContain('Implementing your tRPC API');

      // auth=IAM keeps the IAM example and drops the Cognito one.
      const iam = await callGuide('ts#trpc-api', { auth: 'IAM' });
      expect(iam).toContain('lookup the caller in Cognito using the sub');
      expect(iam).not.toContain('API Gateway Cognito User Pools authorizer');

      // iacProvider=Terraform: <Infrastructure> collapses to the Terraform
      // slot; CDK-specific code is absent.
      const terraform = await callGuide('ts#trpc-api', {
        iacProvider: 'Terraform',
      });
      expect(terraform).toContain('module "my_api"');
      expect(terraform).not.toContain("new MyApi(this, 'MyApi'");

      // computeType=Http narrows the REST/HTTP <Tabs _filter> to just HTTP.
      const http = await callGuide('ts#trpc-api', {
        computeType: 'ServerlessApiGatewayHttpApi',
      });
      expect(http).toContain('APIGatewayProxyEventV2WithIAMAuthorizer');
      expect(http).not.toMatch(/APIGatewayProxyEvent\b(?!V2)/);
      // The REST-only Subscriptions section is wrapped in an <OptionFilter>
      // that doesn't match HTTP, so it should be gone too.
      expect(http).not.toContain('Subscriptions (Streaming)');
    } finally {
      await client.close();
    }
  });

  it('narrows the connection guide by sourceType/targetType/protocol via frontmatter', async () => {
    const registry = process.env.npm_config_registry;
    const version = process.env.NX_E2E_PRESET_VERSION ?? 'latest';
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        ...(registry ? [`--registry=${registry}`] : []),
        `@aws/nx-plugin-mcp@${version}`,
      ],
      env: { ...process.env },
    });

    const client = new Client({
      name: 'e2e-connection-filter-client',
      version: '1.0.0',
    });
    await client.connect(transport);

    const callGuide = async (
      options: Record<string, string>,
    ): Promise<string> => {
      const result = await client.callTool({
        name: 'generator-guide',
        arguments: { packageManager: 'pnpm', generator: 'connection', options },
      });
      return (result.content[0] as { text: string }).text;
    };

    try {
      // Supported pair → overview + react-trpc variant only.
      const reactTrpc = await callGuide({
        sourceType: 'react',
        targetType: 'ts#trpc-api',
      });
      expect(reactTrpc).toContain(
        'end-to-end type safety between your frontend and tRPC backend',
      );
      expect(reactTrpc).not.toContain('FastAPI backends in a type-safe manner');

      // AG-UI protocol pulls the CopilotKit variant and drops the HTTP one.
      const agui = await callGuide({
        sourceType: 'react',
        targetType: 'py#strands-agent',
        protocol: 'AG-UI',
      });
      expect(agui).toContain('AG-UI protocol');
      expect(agui).toContain('CopilotKit');
      // The HTTP (tRPC over WebSocket) react-py-strands page is mentioned in
      // the overview's card grid but its body should NOT be present.
      expect(agui).not.toContain('tRPC over WebSocket');

      // HTTP protocol returns the non-AG-UI variant body.
      const http = await callGuide({
        sourceType: 'react',
        targetType: 'py#strands-agent',
        protocol: 'HTTP',
      });
      expect(http).toContain('tRPC over WebSocket');
      // AG-UI-specific content is dropped.
      expect(http).not.toContain('The AG-UI protocol');

      // Unsupported combination returns an explicit warning instead of an
      // empty guide.
      const unsupported = await callGuide({
        sourceType: 'ts#trpc-api',
        targetType: 'smithy',
      });
      expect(unsupported).toContain('Unsupported combination');
      expect(unsupported).toContain('Supported combinations:');
      // The warning lists real combinations from the guide frontmatter.
      expect(unsupported).toMatch(
        /sourceType = react.*targetType = ts#trpc-api/,
      );
    } finally {
      await client.close();
    }
  });

  it('surfaces filterable options on list-generators — schema enums and frontmatter keys', async () => {
    const registry = process.env.npm_config_registry;
    const version = process.env.NX_E2E_PRESET_VERSION ?? 'latest';
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        ...(registry ? [`--registry=${registry}`] : []),
        `@aws/nx-plugin-mcp@${version}`,
      ],
      env: { ...process.env },
    });

    const client = new Client({
      name: 'e2e-list-filterable-client',
      version: '1.0.0',
    });
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: 'list-generators',
        arguments: { packageManager: 'pnpm' },
      });
      const text = (result.content[0] as { text: string }).text;

      // Schema-enum keys on ts#trpc-api — computeType and auth are both
      // enum properties so they should appear in that generator's entry.
      const trpcStart = text.indexOf('### ts#trpc-api');
      const trpcEnd = text.indexOf('###', trpcStart + 5);
      const trpc = text.slice(
        trpcStart,
        trpcEnd > trpcStart ? trpcEnd : undefined,
      );
      expect(trpc).toMatch(/`generator-guide` options/);
      expect(trpc).toMatch(/computeType: ServerlessApiGatewayRestApi/);
      expect(trpc).toMatch(/auth: IAM \| Cognito \| None/);

      // Connection generator: keys come from the union of `when:`
      // frontmatter blocks on each variant page.
      const connStart = text.indexOf('### connection');
      const connEnd = text.indexOf('###', connStart + 5);
      const conn = text.slice(
        connStart,
        connEnd > connStart ? connEnd : undefined,
      );
      expect(conn).toMatch(/`generator-guide` options/);
      expect(conn).toMatch(/sourceType:/);
      expect(conn).toMatch(/targetType:/);
      expect(conn).toMatch(/protocol:/);
      // The hint steers agents to call generator-guide with options.
      expect(conn).toContain('call `generator-guide`');
    } finally {
      await client.close();
    }
  });
});
