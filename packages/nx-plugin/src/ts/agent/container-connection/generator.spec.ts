/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  logger,
  readJson,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../../utils/metrics-assertions.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import {
  TS_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO,
  tsAgentContainerConnectionGenerator,
} from './generator.js';
import {
  cdkAgentContainerWiring,
  terraformAgentContainerWiring,
} from './wiring.js';

// The callback installs packages, which needs a real workspace on disk.
vi.mock('../../../utils/install.js', () => ({
  installDependencies: vi.fn(),
}));

const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/connection/ts-agent-container.mdx',
);
const CLIENT = 'packages/common/agent-connection/src/app/orders-client.ts';
const INDEX = 'packages/common/agent-connection/src/index.ts';

const changedFiles = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

const AGENT = {
  generator: 'ts#agent',
  name: 'helper',
  path: 'src/helper',
  port: 8081,
  rc: 'Helper',
  auth: 'iam',
  protocol: 'http',
};

const service = (overrides: Record<string, unknown> = {}) => ({
  generator: 'ts#container',
  name: 'orders',
  path: 'src/orders',
  port: 8083,
  rc: 'Orders',
  infra: 'ecs',
  ingress: 'http-api',
  auth: 'iam',
  iac: 'cdk',
  ...overrides,
});

describe('ts#agent#container-connection generator', () => {
  let tree: Tree;

  const writeService = (overrides: Record<string, unknown> = {}) =>
    tree.write(
      'packages/svc/project.json',
      JSON.stringify({
        name: 'svc',
        root: 'packages/svc',
        sourceRoot: 'packages/svc/src',
        targets: {
          'orders-serve': { executor: 'nx:run-commands', continuous: true },
        },
        metadata: { components: [service(overrides)] },
      }),
    );

  const run = (overrides: Record<string, unknown> = {}) =>
    tsAgentContainerConnectionGenerator(tree, {
      sourceProject: 'agents',
      targetProject: 'svc',
      sourceComponent: AGENT,
      targetComponent: service(overrides),
    });

  const runAndCaptureInfo = async (
    overrides: Record<string, unknown> = {},
  ): Promise<string[]> => {
    const callback = await run(overrides);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    await callback();
    const messages = info.mock.calls.map((c) => String(c[0]));
    info.mockRestore();
    return messages;
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write(
      'packages/agents/project.json',
      JSON.stringify({
        name: 'agents',
        root: 'packages/agents',
        sourceRoot: 'packages/agents/src',
        targets: {
          'helper-dev': { executor: 'nx:run-commands', continuous: true },
        },
        metadata: { components: [AGENT] },
      }),
    );
    writeService();
  });

  it('should vend the client into the agent-connection project', async () => {
    await run();

    expect(tree.read(CLIENT, 'utf-8')).toMatchSnapshot();
    expect(tree.read(INDEX, 'utf-8')).toContain(
      "export * from './app/orders-client.js';",
    );
  });

  it('should add the client packages to the agent-connection project', async () => {
    await run();

    const { dependencies } = readJson(
      tree,
      'packages/common/agent-connection/package.json',
    );
    expect(dependencies).toEqual(
      expect.objectContaining({
        '@aws-lambda-powertools/parameters': 'catalog:',
        '@aws-sdk/credential-providers': 'catalog:',
        aws4fetch: 'catalog:',
      }),
    );
  });

  it("should start the service with the agent's dev target", async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'agents').targets?.['helper-dev']
        .dependsOn,
    ).toEqual([{ projects: ['svc'], target: 'orders-serve' }]);
  });

  it('should vend the same client for a py#container service', async () => {
    await run();
    const tsClient = tree.read(CLIENT, 'utf-8');

    writeService({ generator: 'py#container' });
    tree.delete(CLIENT);
    await run({ generator: 'py#container' });

    expect(tree.read(CLIENT, 'utf-8')).toEqual(tsClient);
  });

  it('should change nothing on a second run', async () => {
    await run();
    const first = changedFiles(tree);

    await run();

    expect(changedFiles(tree)).toEqual(first);
  });

  it.each([
    [
      { infra: 'none', ingress: undefined, auth: undefined },
      'A container service is reached through the infrastructure ecs vends.',
    ],
    [
      { ingress: 'private', auth: undefined },
      'A website or agent reaches a container service through its HTTP API. A private service is reachable only from inside its VPC.',
    ],
    [
      { auth: 'cognito' },
      'An agent signs its request to a container service with IAM from its own role.',
    ],
    [
      { auth: 'none' },
      'An agent signs its request to a container service with IAM from its own role.',
    ],
  ])('should reject %o', async (overrides, reason) => {
    await expect(run(overrides)).rejects.toThrow(
      `Cannot connect agents (helper) to svc (orders): ${reason}`,
    );
  });

  describe('wiring message', () => {
    it('should print the CDK grant', async () => {
      expect(await runAndCaptureInfo()).toEqual([
        `Let the Helper agent call the Orders container service. Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where orders is your Orders construct and helper is your Helper construct. Until you add it, the service's HTTP API rejects the agent's requests with 403 Forbidden.

orders.grantInvoke(helper);`,
      ]);
    });

    it('should print the Terraform policy statement', async () => {
      expect(await runAndCaptureInfo({ iac: 'terraform' })).toEqual([
        `Let the Helper agent call the Orders container service. Add the additional_iam_policy_statements entry below to the agent's module block in the root Terraform module, for example packages/infra/src/main.tf, where module "orders" deploys the service. Merge it with any statements the block already lists. Until you add it, the service's HTTP API rejects the agent's requests with 403 Forbidden.

module "helper" {
  source = "../../common/terraform/src/app/agents/helper"
  # ...existing arguments...
  additional_iam_policy_statements = [
    {
      Effect   = "Allow"
      Action   = ["execute-api:Invoke"]
      Resource = ["\${module.orders.api_execution_arn}/*"]
    },
  ]
}`,
      ]);
    });

    it.each(['cdk', 'terraform'] as const)(
      'should show the %s code in the guide',
      (iac) => {
        const names = {
          nameClassName: 'MyService',
          moduleName: 'my_service',
          variableName: 'myService',
          agentClassName: 'MyAgent',
        };
        const code =
          iac === 'cdk'
            ? cdkAgentContainerWiring(names)
            : terraformAgentContainerWiring(names);

        expect(readFileSync(GUIDE_FILE, 'utf-8')).toContain(code);
      },
    );
  });

  it('should record the connection on the agent project', async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'agents').metadata?.components,
    ).toContainEqual({
      generator: TS_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO.id,
      name: 'helper-Orders',
      path: 'packages/svc/src/orders',
      sourcePath: 'src/helper',
    });
  });

  it('should add the generator metric to app.ts', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );

    await run();

    expectHasMetricTags(
      tree,
      TS_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO.metric,
    );
  });
});
