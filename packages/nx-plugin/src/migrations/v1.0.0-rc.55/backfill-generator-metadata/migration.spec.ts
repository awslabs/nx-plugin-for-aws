/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  joinPathFragments,
  readProjectConfiguration,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import generatorsJson from '../../../../generators.json';
import { DCR_PROXY_HANDLERS } from '../../../utils/dcr-proxy-constructs/dcr-proxy-constructs';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration, { CONNECTION_KINDS } from './migration';

/**
 * A workspace whose shared infrastructure project was generated with the given
 * provider, registering a build dependency for each project that received
 * infrastructure — which is how the generators record it.
 */
const seedInfrastructure = (
  tree: Tree,
  iac: 'cdk' | 'terraform',
  projectNames: string[],
) =>
  writeJson(
    tree,
    joinPathFragments(
      'packages/common',
      iac === 'cdk' ? 'constructs' : 'terraform',
      'project.json',
    ),
    {
      name: iac === 'cdk' ? '@proj/common-constructs' : '@proj/terraform',
      targets: {
        build: {
          dependsOn: projectNames.map((name) => `${name}:build`),
        },
      },
    },
  );

const metadataOf = (tree: Tree, project: string) =>
  readProjectConfiguration(tree, project).metadata as any;

const componentOf = (tree: Tree, project: string, generator: string) =>
  (metadataOf(tree, project).components ?? []).find(
    (component: any) => component.generator === generator,
  );

describe('backfill-generator-metadata migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('iac', () => {
    it('should record the provider that generated a project its infrastructure', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/api']);
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: { generator: 'ts#trpc-api' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/api').iac).toBe('cdk');
    });

    it('should record terraform from the shared terraform project', async () => {
      seedInfrastructure(tree, 'terraform', ['@proj/api']);
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: { generator: 'ts#trpc-api' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/api').iac).toBe('terraform');
    });

    // `iac` is a per-generator option, so one workspace can hold both providers.
    it('should record each project the provider its own infrastructure used', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/api']);
      seedInfrastructure(tree, 'terraform', ['@proj/website']);
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: { generator: 'ts#trpc-api' } as never,
      });
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        metadata: { generator: 'ts#react-website' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/api').iac).toBe('cdk');
      expect(metadataOf(tree, '@proj/website').iac).toBe('terraform');
    });

    // Recording an `iac` for a project generated with `infra: 'none'` would have
    // the sync claim the infra helpers' packages, which it never received.
    it('should record no iac for a project that got no infrastructure', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/api']);
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: { generator: 'ts#trpc-api' } as never,
      });
      addProjectConfiguration(tree, '@proj/standalone', {
        root: 'packages/standalone',
        metadata: { generator: 'ts#trpc-api' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/standalone').iac).toBeUndefined();
    });

    it('should leave an iac the project already records alone', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/api']);
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: { generator: 'ts#trpc-api', iac: 'terraform' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/api').iac).toBe('terraform');
    });

    // An agent and an MCP server are components rather than projects, and each
    // chooses its own provider — so the project-level build dependency isn't
    // precise enough and the generators record `iac` on the component.
    it('should record a component the provider its own infrastructure used', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/app']);
      tree.write(
        'packages/common/constructs/src/app/agents/my-agent/my-agent.ts',
        'export {};\n',
      );
      addProjectConfiguration(tree, '@proj/app', {
        root: 'packages/app',
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#agent', name: 'my-agent', path: 'src/my-agent' },
            { generator: 'ts#agent', name: 'no-infra', path: 'src/no-infra' },
          ],
        } as never,
      });

      await migration(tree);

      const components = metadataOf(tree, '@proj/app').components;
      expect(components[0].iac).toBe('cdk');
      // Generated with `infra: 'none'`, so it received no infrastructure.
      expect(components[1].iac).toBeUndefined();
    });

    it('should record an mcp server component from its own module', async () => {
      seedInfrastructure(tree, 'terraform', ['@proj/mcp']);
      tree.write(
        'packages/common/terraform/src/app/mcp-servers/server/server.tf',
        'resource "null_resource" "server" {}\n',
      );
      addProjectConfiguration(tree, '@proj/mcp', {
        root: 'packages/mcp',
        metadata: {
          generator: 'ts#project',
          components: [{ generator: 'ts#mcp-server', name: 'server' }],
        } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/mcp').components[0].iac).toBe('terraform');
    });

    // A Lambda function is one file under CDK but a directory under Terraform, so
    // both shapes have to be recognised.
    it('should record a lambda function component from its cdk construct file', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/fns']);
      tree.write(
        'packages/common/constructs/src/app/lambda-functions/my-fn.ts',
        'export {};\n',
      );
      addProjectConfiguration(tree, '@proj/fns', {
        root: 'packages/fns',
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#lambda-function', name: 'my-fn' },
            { generator: 'ts#lambda-function', name: 'no-infra' },
          ],
        } as never,
      });

      await migration(tree);

      const components = metadataOf(tree, '@proj/fns').components;
      expect(components[0].iac).toBe('cdk');
      expect(components[1].iac).toBeUndefined();
    });

    it('should record a lambda function component from its terraform module', async () => {
      seedInfrastructure(tree, 'terraform', ['proj.fns']);
      tree.write(
        'packages/common/terraform/src/app/lambda-functions/my_fn/my_fn.tf',
        'resource "null_resource" "fn" {}\n',
      );
      addProjectConfiguration(tree, 'proj.fns', {
        root: 'packages/fns',
        metadata: {
          generator: 'py#project',
          components: [{ generator: 'py#lambda-function', name: 'my_fn' }],
        } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, 'proj.fns').components[0].iac).toBe('terraform');
    });

    // The auth component vends no infrastructure of its own — it always generates
    // the shared constructs — so it took whichever provider the website used.
    it('should record the website auth component the project provider', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/website']);
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        metadata: {
          generator: 'ts#react-website',
          components: [{ generator: 'ts#react-website#auth' }],
        } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/website').components[0].iac).toBe('cdk');
    });

    it('should record no auth iac where the website got no infrastructure', async () => {
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        metadata: {
          generator: 'ts#react-website',
          components: [{ generator: 'ts#react-website#auth' }],
        } as never,
      });

      await migration(tree);

      expect(
        metadataOf(tree, '@proj/website').components[0].iac,
      ).toBeUndefined();
    });

    it('should leave a project no generator created alone', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/hand-written']);
      addProjectConfiguration(tree, '@proj/hand-written', {
        root: 'packages/hand-written',
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/hand-written')).toBeUndefined();
    });

    // Materialising an empty list would put `"components": []` in the diff of
    // every project that has none, which is noise a reviewer has to read past.
    it('should not add a components list to a project without one', async () => {
      seedInfrastructure(tree, 'cdk', ['@proj/api']);
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: { generator: 'ts#smithy-api', apiName: 'my-api' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/api')).not.toHaveProperty('components');
    });
  });

  // `ts#dcr-proxy` creates its project through `ts#project`, which recorded its
  // own id — so the proxy's dependencies went unowned.
  describe('ts#dcr-proxy', () => {
    const seedHandlers = (tree: Tree, root: string) => {
      for (const handler of DCR_PROXY_HANDLERS) {
        tree.write(
          joinPathFragments(root, 'src', 'handlers', `${handler}.ts`),
          'export {};\n',
        );
      }
    };

    it('should re-attribute a project carrying the vended handlers', async () => {
      seedHandlers(tree, 'packages/proxy');
      addProjectConfiguration(tree, '@proj/proxy', {
        root: 'packages/proxy',
        metadata: { generator: 'ts#project' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/proxy').generator).toBe('ts#dcr-proxy');
    });

    it('should leave a plain ts#project alone', async () => {
      addProjectConfiguration(tree, '@proj/lib', {
        root: 'packages/lib',
        metadata: { generator: 'ts#project' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/lib').generator).toBe('ts#project');
    });

    // A project with only some handlers has diverged from the vended shape, so
    // calling it a dcr-proxy would be a guess.
    it('should leave a project with only some handlers alone', async () => {
      tree.write('packages/partial/src/handlers/token.ts', 'export {};\n');
      addProjectConfiguration(tree, '@proj/partial', {
        root: 'packages/partial',
        metadata: { generator: 'ts#project' } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/partial').generator).toBe('ts#project');
    });
  });

  // Neither field gates a dependency yet, but recording them now means a future
  // gate reads them in a workspace this backfill has already run on.
  describe('smithy projects', () => {
    const seedSmithyProject = (
      tree: Tree,
      options: { plugins: boolean; namespace: string },
    ) => {
      writeJson(tree, 'packages/model/smithy-build.json', {
        version: '1.0',
        // A service builds an OpenAPI spec and an SSDK from its model; a shape
        // library only shares shapes and gets no plugins.
        ...(options.plugins
          ? { plugins: { openapi: {}, 'typescript-ssdk-codegen': {} } }
          : {}),
        maven: { dependencies: ['software.amazon.smithy:smithy-model:1.61.0'] },
      });
      tree.write(
        'packages/model/src/main.smithy',
        `$version: "2.0"\n\nnamespace ${options.namespace}\n\nstructure Example {}\n`,
      );
      addProjectConfiguration(tree, '@proj/model', {
        root: 'packages/model',
        sourceRoot: 'packages/model/src',
        metadata: { generator: 'smithy#project', apiName: 'my-api' } as never,
      });
    };

    it('should record a service from the build plugins it generated', async () => {
      seedSmithyProject(tree, { plugins: true, namespace: 'com.example' });

      await migration(tree);

      const metadata = metadataOf(tree, '@proj/model');
      expect(metadata.smithyType).toBe('service');
      expect(metadata.namespace).toBe('com.example');
    });

    it('should record a shape library from the absence of those plugins', async () => {
      seedSmithyProject(tree, { plugins: false, namespace: 'com.shapes' });

      await migration(tree);

      const metadata = metadataOf(tree, '@proj/model');
      expect(metadata.smithyType).toBe('shapes');
      expect(metadata.namespace).toBe('com.shapes');
    });

    // The namespace is a generator option, so it is read from the model rather
    // than derived from the npm scope.
    it('should record a namespace that is not the scope default', async () => {
      seedSmithyProject(tree, { plugins: true, namespace: 'my.own.namespace' });

      await migration(tree);

      expect(metadataOf(tree, '@proj/model').namespace).toBe(
        'my.own.namespace',
      );
    });

    it('should leave a smithy project already recording both alone', async () => {
      seedSmithyProject(tree, { plugins: true, namespace: 'com.example' });
      addProjectConfiguration(tree, '@proj/other', {
        root: 'packages/other',
        metadata: {
          generator: 'smithy#project',
          smithyType: 'shapes',
          namespace: 'kept.as.is',
        } as never,
      });

      await migration(tree);

      const metadata = metadataOf(tree, '@proj/other');
      expect(metadata.smithyType).toBe('shapes');
      expect(metadata.namespace).toBe('kept.as.is');
    });
  });

  describe('website options', () => {
    const seedWebsite = (tree: Tree, viteConfig: string) => {
      tree.write('packages/website/vite.config.mts', viteConfig);
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        sourceRoot: 'packages/website/src',
        metadata: { generator: 'ts#react-website', ux: 'shadcn' } as never,
      });
    };

    it('should record the options from the plugins their generation registered', async () => {
      seedWebsite(
        tree,
        `import { defineConfig } from 'vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [tanstackRouter({ routesDirectory: 'src/routes' }), tailwindcss()],
});
`,
      );

      await migration(tree);

      const metadata = metadataOf(tree, '@proj/website');
      expect(metadata.tailwind).toBe(true);
      expect(metadata.tanstackRouter).toBe(true);
    });

    // Both options default to true, so only their absence from the config proves
    // the website was generated without them.
    it('should record them false when the plugins are absent', async () => {
      seedWebsite(
        tree,
        `import { defineConfig } from 'vite';
export default defineConfig({ plugins: [] });
`,
      );

      await migration(tree);

      const metadata = metadataOf(tree, '@proj/website');
      expect(metadata.tailwind).toBe(false);
      expect(metadata.tanstackRouter).toBe(false);
    });

    it('should leave options the website already records alone', async () => {
      tree.write(
        'packages/website/vite.config.mts',
        "import tailwindcss from '@tailwindcss/vite';\nexport default { plugins: [tailwindcss()] };\n",
      );
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        metadata: {
          generator: 'ts#react-website',
          tailwind: false,
          tanstackRouter: false,
        } as never,
      });

      await migration(tree);

      expect(metadataOf(tree, '@proj/website').tailwind).toBe(false);
    });
  });

  describe('agent connections', () => {
    /** An agent project whose agent imports the given clients. */
    const seedAgent = (
      tree: Tree,
      options: {
        extension: 'ts' | 'py';
        generator: string;
        agentSource: string;
        framework?: string;
      },
    ) => {
      tree.write(
        `packages/app/src/my-agent/agent.${options.extension}`,
        options.agentSource,
      );
      addProjectConfiguration(tree, '@proj/app', {
        root: 'packages/app',
        metadata: {
          generator: 'ts#project',
          components: [
            {
              generator: options.generator,
              name: 'my-agent',
              path: 'src/my-agent',
              rc: 'MyAgent',
              ...(options.framework ? { framework: options.framework } : {}),
            },
          ],
        } as never,
      });
    };

    /** An MCP server the connection could have been made to. */
    const seedMcpServer = (tree: Tree) =>
      addProjectConfiguration(tree, '@proj/mcp', {
        root: 'packages/mcp',
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#mcp-server', name: 'server', rc: 'MyServer' },
          ],
        } as never,
      });

    it('should record a ts agent mcp connection from the client it imports', async () => {
      seedMcpServer(tree);
      seedAgent(tree, {
        extension: 'ts',
        generator: 'ts#agent',
        agentSource: `import { MyServerClientStrands } from '@proj/agent-connection';
const client = new MyServerClientStrands();
`,
      });

      await migration(tree);

      expect(componentOf(tree, '@proj/app', 'ts#agent#mcp-connection')).toEqual(
        {
          generator: 'ts#agent#mcp-connection',
          path: 'src/my-agent/agent.ts',
          name: 'MyServer',
          sourcePath: 'src/my-agent',
        },
      );
    });

    // The Python clients' extra dependencies follow the source agent's framework,
    // which the agent itself recorded.
    it('should record a py agent mcp connection with its source framework', async () => {
      seedMcpServer(tree);
      seedAgent(tree, {
        extension: 'py',
        generator: 'py#agent',
        framework: 'langchain',
        agentSource: `from .app.my_server_client_langchain import MyServerClientLangChain

client = MyServerClientLangChain()
`,
      });

      await migration(tree);

      expect(componentOf(tree, '@proj/app', 'py#agent#mcp-connection')).toEqual(
        {
          generator: 'py#agent#mcp-connection',
          path: 'src/my-agent/agent.py',
          name: 'MyServer',
          sourcePath: 'src/my-agent',
          framework: 'langchain',
        },
      );
    });

    it('should default an unrecorded framework to strands', async () => {
      seedMcpServer(tree);
      seedAgent(tree, {
        extension: 'py',
        generator: 'py#agent',
        agentSource:
          'from .app.my_server_client_strands import MyServerClientStrands\n',
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/app', 'py#agent#mcp-connection').framework,
      ).toBe('strands');
    });

    // Without the client import there is no connection to record, and inventing
    // one would have the sync own packages the project never received.
    it('should record nothing for an agent that imports no client', async () => {
      seedMcpServer(tree);
      seedAgent(tree, {
        extension: 'ts',
        generator: 'ts#agent',
        agentSource: 'export const agent = {};\n',
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/app', 'ts#agent#mcp-connection'),
      ).toBeUndefined();
    });

    it('should record only the target whose client is imported', async () => {
      seedMcpServer(tree);
      addProjectConfiguration(tree, '@proj/other-mcp', {
        root: 'packages/other-mcp',
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#mcp-server', name: 'other', rc: 'OtherServer' },
          ],
        } as never,
      });
      seedAgent(tree, {
        extension: 'ts',
        generator: 'ts#agent',
        agentSource:
          "import { MyServerClientStrands } from '@proj/agent-connection';\n",
      });

      await migration(tree);

      const connections = metadataOf(tree, '@proj/app').components.filter(
        (component: any) => component.generator === 'ts#agent#mcp-connection',
      );
      expect(connections.map((c: any) => c.name)).toEqual(['MyServer']);
    });

    it('should record an a2a connection between two agents', async () => {
      addProjectConfiguration(tree, '@proj/remote', {
        root: 'packages/remote',
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#agent', name: 'remote', rc: 'RemoteAgent' },
          ],
        } as never,
      });
      seedAgent(tree, {
        extension: 'ts',
        generator: 'ts#agent',
        agentSource:
          "import { RemoteAgentClientStrands } from '@proj/agent-connection';\n",
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/app', 'ts#agent#a2a-connection').name,
      ).toBe('RemoteAgent');
    });

    it('should record a gateway connection from the gateway project', async () => {
      addProjectConfiguration(tree, '@proj/gateway', {
        root: 'packages/gateway',
        metadata: {
          generator: 'agentcore-gateway',
          name: 'gateway',
          rc: 'MyGateway',
        } as never,
      });
      seedAgent(tree, {
        extension: 'ts',
        generator: 'ts#agent',
        agentSource:
          "import { MyGatewayClientStrands } from '@proj/agent-connection';\n",
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/app', 'ts#agent#gateway-connection').name,
      ).toBe('MyGateway');
    });

    it('should leave a connection the project already records alone', async () => {
      seedMcpServer(tree);
      tree.write(
        'packages/app/src/my-agent/agent.ts',
        "import { MyServerClientStrands } from '@proj/agent-connection';\n",
      );
      addProjectConfiguration(tree, '@proj/app', {
        root: 'packages/app',
        metadata: {
          generator: 'ts#project',
          components: [
            {
              generator: 'ts#agent',
              name: 'my-agent',
              path: 'src/my-agent',
              rc: 'MyAgent',
            },
            {
              generator: 'ts#agent#mcp-connection',
              name: 'MyServer',
              path: 'src/my-agent/agent.ts',
            },
          ],
        } as never,
      });

      await migration(tree);

      const connections = metadataOf(tree, '@proj/app').components.filter(
        (component: any) => component.generator === 'ts#agent#mcp-connection',
      );
      expect(connections).toHaveLength(1);
    });
  });

  describe('website connections', () => {
    const seedWebsite = (tree: Tree, providers: string[]) => {
      for (const provider of providers) {
        tree.write(
          `packages/website/src/components/${provider}.tsx`,
          'export default () => null;\n',
        );
      }
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        sourceRoot: 'packages/website/src',
        metadata: { generator: 'ts#react-website' } as never,
      });
    };

    it('should record a trpc connection with the api options it reads', async () => {
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: {
          generator: 'ts#trpc-api',
          apiName: 'my-api',
          auth: 'Cognito',
          infra: 'rest-lambda',
        } as never,
      });
      seedWebsite(tree, ['MyApiClientProvider']);

      await migration(tree);

      expect(
        componentOf(tree, '@proj/website', 'ts#trpc-api#react-connection'),
      ).toEqual({
        generator: 'ts#trpc-api#react-connection',
        path: 'src/components/MyApiClientProvider',
        name: 'MyApi',
        auth: 'cognito',
        isRestApi: true,
      });
    });

    it('should record isRestApi false for a non-rest integration', async () => {
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: {
          generator: 'ts#trpc-api',
          apiName: 'my-api',
          infra: 'http-lambda',
        } as never,
      });
      seedWebsite(tree, ['MyApiClientProvider']);

      await migration(tree);

      const connection = componentOf(
        tree,
        '@proj/website',
        'ts#trpc-api#react-connection',
      );
      expect(connection.isRestApi).toBe(false);
      expect(connection.auth).toBe('iam');
    });

    it('should record a smithy connection from its provider component', async () => {
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: {
          generator: 'ts#smithy-api',
          apiName: 'store-api',
        } as never,
      });
      seedWebsite(tree, ['StoreApiProvider']);

      await migration(tree);

      expect(
        componentOf(tree, '@proj/website', 'smithy#react-connection').name,
      ).toBe('StoreApi');
    });

    it('should record nothing for an api the website never connected to', async () => {
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: {
          generator: 'ts#trpc-api',
          apiName: 'my-api',
        } as never,
      });
      seedWebsite(tree, []);

      await migration(tree);

      expect(
        componentOf(tree, '@proj/website', 'ts#trpc-api#react-connection'),
      ).toBeUndefined();
    });
  });

  // These connections own no dependencies today, so they are recorded purely so
  // the sync picks them up when they start to.
  describe('database connections', () => {
    /** A database project a connection could have been made to. */
    const seedDatabase = (tree: Tree, name: string, generator: string) =>
      addProjectConfiguration(tree, name, {
        root: `packages/${name.split(/[/.]/).pop()}`,
        metadata: { generator } as never,
      });

    it('should record an rdb agent connection from the client getter it imports', async () => {
      seedDatabase(tree, '@proj/my-db', 'ts#rdb');
      tree.write(
        'packages/app/src/my-agent/agent.ts',
        `import { getPrisma as getMyDb } from '@proj/my-db';
export const getAgent = async () => {
  const myDb = await getMyDb();
};
`,
      );
      addProjectConfiguration(tree, '@proj/app', {
        root: 'packages/app',
        metadata: {
          generator: 'ts#project',
          components: [
            {
              generator: 'ts#agent',
              name: 'my-agent',
              path: 'src/my-agent',
              rc: 'MyAgent',
            },
          ],
        } as never,
      });

      await migration(tree);

      expect(componentOf(tree, '@proj/app', 'ts#rdb#agent-connection')).toEqual(
        {
          generator: 'ts#rdb#agent-connection',
          path: 'src/my-agent/agent.ts',
          // `<sourceComponent>-<database>`, as the generator records it.
          name: 'my-agent-myDb',
          sourcePath: 'src/my-agent',
        },
      );
    });

    it('should record an rdb trpc connection from the middleware it vends', async () => {
      seedDatabase(tree, '@proj/my-db', 'ts#rdb');
      tree.write('packages/api/src/middleware/my-db.ts', 'export {};\n');
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        metadata: { generator: 'ts#trpc-api', apiName: 'my-api' } as never,
      });

      await migration(tree);

      expect(componentOf(tree, '@proj/api', 'ts#rdb#trpc-connection')).toEqual({
        generator: 'ts#rdb#trpc-connection',
        path: 'src/middleware/my-db.ts',
        name: 'myDb',
      });
    });

    it('should record a fast-api rdb connection from the dependency module it vends', async () => {
      seedDatabase(tree, 'proj.my_db', 'py#rdb');
      tree.write(
        'packages/api/proj_my_api/dependencies/my_db.py',
        'def get_my_db():\n    pass\n',
      );
      addProjectConfiguration(tree, 'proj.my_api', {
        root: 'packages/api',
        metadata: { generator: 'py#fast-api', apiName: 'my-api' } as never,
      });

      await migration(tree);

      expect(
        componentOf(tree, 'proj.my_api', 'py#rdb#fast-api-connection'),
      ).toEqual({
        generator: 'py#rdb#fast-api-connection',
        path: 'proj_my_api/dependencies/my_db.py',
        name: 'my_db',
      });
    });

    // The DynamoDB connections grant IAM in the target's infrastructure rather
    // than vending code, so the dev chain is the only trace they leave.
    it('should record a dynamodb agent connection from the dev chain it wires', async () => {
      seedDatabase(tree, '@proj/my-table', 'ts#dynamodb');
      addProjectConfiguration(tree, '@proj/app', {
        root: 'packages/app',
        targets: {
          'my-agent-dev': {
            dependsOn: [{ projects: '@proj/my-table', target: 'dev' }],
          },
        },
        metadata: {
          generator: 'ts#project',
          components: [
            {
              generator: 'ts#agent',
              name: 'my-agent',
              path: 'src/my-agent',
              rc: 'MyAgent',
            },
          ],
        } as never,
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/app', 'ts#dynamodb#agent-connection'),
      ).toEqual({
        generator: 'ts#dynamodb#agent-connection',
        path: 'packages/my-table',
        name: 'my-agent-@proj/my-table',
        sourcePath: 'src/my-agent',
      });
    });

    it('should record nothing for a database the dev chain never reaches', async () => {
      seedDatabase(tree, '@proj/my-table', 'ts#dynamodb');
      addProjectConfiguration(tree, '@proj/app', {
        root: 'packages/app',
        targets: { 'my-agent-dev': {} },
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#agent', name: 'my-agent', path: 'src/my-agent' },
          ],
        } as never,
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/app', 'ts#dynamodb#agent-connection'),
      ).toBeUndefined();
    });
  });

  describe('gateway connections', () => {
    it('should record an upstream registered in the gateway local-dev', async () => {
      addProjectConfiguration(tree, '@proj/mcp', {
        root: 'packages/mcp',
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#mcp-server', name: 'server', rc: 'MyServer' },
          ],
        } as never,
      });
      tree.write(
        'packages/gateway/local-dev.ts',
        `const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [
  { name: 'my-server', url: 'http://localhost:8000/mcp' },
];
`,
      );
      addProjectConfiguration(tree, '@proj/gateway', {
        root: 'packages/gateway',
        metadata: {
          generator: 'agentcore-gateway',
          name: 'gateway',
          rc: 'MyGateway',
          protocol: 'mcp',
        } as never,
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/gateway', 'agentcore-gateway#mcp-connection'),
      ).toEqual({
        generator: 'agentcore-gateway#mcp-connection',
        path: 'packages/mcp',
        // Kebab-cased class name, matching the target the deployed gateway uses.
        name: 'my-server',
      });
    });

    it('should record nothing for an upstream the gateway never attached', async () => {
      addProjectConfiguration(tree, '@proj/mcp', {
        root: 'packages/mcp',
        metadata: {
          generator: 'ts#project',
          components: [
            { generator: 'ts#mcp-server', name: 'server', rc: 'MyServer' },
          ],
        } as never,
      });
      tree.write(
        'packages/gateway/local-dev.ts',
        'const ATTACHED_MCP_SERVERS: AttachedMcpServer[] = [];\n',
      );
      addProjectConfiguration(tree, '@proj/gateway', {
        root: 'packages/gateway',
        metadata: {
          generator: 'agentcore-gateway',
          rc: 'MyGateway',
          protocol: 'mcp',
        } as never,
      });

      await migration(tree);

      expect(
        componentOf(tree, '@proj/gateway', 'agentcore-gateway#mcp-connection'),
      ).toBeUndefined();
    });
  });

  it('should be idempotent', async () => {
    seedInfrastructure(tree, 'cdk', ['@proj/app']);
    addProjectConfiguration(tree, '@proj/mcp', {
      root: 'packages/mcp',
      metadata: {
        generator: 'ts#project',
        components: [
          { generator: 'ts#mcp-server', name: 'server', rc: 'MyServer' },
        ],
      } as never,
    });
    tree.write(
      'packages/app/src/my-agent/agent.ts',
      "import { MyServerClientStrands } from '@proj/agent-connection';\n",
    );
    addProjectConfiguration(tree, '@proj/app', {
      root: 'packages/app',
      metadata: {
        generator: 'ts#project',
        components: [
          {
            generator: 'ts#agent',
            name: 'my-agent',
            path: 'src/my-agent',
            rc: 'MyAgent',
          },
        ],
      } as never,
    });

    await migration(tree);
    const first = tree.read('packages/app/project.json', 'utf-8');

    await migration(tree);

    expect(tree.read('packages/app/project.json', 'utf-8')).toBe(first);
  });

  // Every connection is recorded, including those adding no dependencies today:
  // the sync reads the metadata rather than the generator, so a connection recorded
  // now is picked up the moment its generator starts owning packages — otherwise a
  // later release needs a second backfill for workspaces this one already ran on.
  it('should cover exactly the connection generators that predate this backfill', () => {
    // The backfill is point-in-time: it recovers metadata for connections
    // made by generators that shipped before it. Every generator since
    // records its own metadata, so this pinned list never grows — a new
    // connection generator must NOT be added here or to CONNECTION_KINDS.
    const BACKFILLED_CONNECTION_GENERATORS = [
      'agentcore-gateway#gateway-connection',
      'agentcore-gateway#mcp-connection',
      'py#agent#a2a-connection',
      'py#agent#gateway-connection',
      'py#agent#mcp-connection',
      'py#agent#react-connection',
      'py#dynamodb#agent-connection',
      'py#dynamodb#fast-api-connection',
      'py#dynamodb#mcp-server-connection',
      'py#fast-api#react-connection',
      'py#rdb#agent-connection',
      'py#rdb#fast-api-connection',
      'py#rdb#mcp-server-connection',
      'smithy#react-connection',
      'ts#agent#a2a-connection',
      'ts#agent#gateway-connection',
      'ts#agent#mcp-connection',
      'ts#agent#react-connection',
      'ts#dynamodb#agent-connection',
      'ts#dynamodb#mcp-server-connection',
      'ts#dynamodb#smithy-connection',
      'ts#dynamodb#trpc-connection',
      'ts#rdb#agent-connection',
      'ts#rdb#mcp-server-connection',
      'ts#rdb#smithy-connection',
      'ts#rdb#trpc-connection',
      'ts#trpc-api#react-connection',
    ];
    // Each backfilled generator must still exist under the id the metadata
    // records (`connection` is the dispatcher, not itself recorded).
    const registered = new Set(
      Object.keys(generatorsJson.generators).filter(
        (id) => id.endsWith('-connection') && id !== 'connection',
      ),
    );
    for (const id of BACKFILLED_CONNECTION_GENERATORS) {
      expect(registered).toContain(id);
    }

    const covered = CONNECTION_KINDS.map((kind) => kind.id).sort();
    expect(covered).toEqual([...BACKFILLED_CONNECTION_GENERATORS].sort());
  });
});
