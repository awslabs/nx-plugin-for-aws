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
  TS_CONTAINER_REACT_CONNECTION_GENERATOR_INFO,
  tsContainerReactConnectionGenerator,
} from './generator.js';
import {
  cdkReactContainerWiring,
  terraformReactContainerWiring,
} from './wiring.js';

// The callback installs packages, which needs a real workspace on disk.
vi.mock('../../../utils/install.js', () => ({
  installDependencies: vi.fn(),
}));

const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/connection/react-container.mdx',
);
const HOOK = 'apps/frontend/src/hooks/useOrders.tsx';
const SIGV4_HOOK = 'apps/frontend/src/hooks/useSigV4.tsx';
const PROVIDER = 'apps/frontend/src/components/RuntimeConfig/index.tsx';

const changedFiles = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

const component = (overrides: Record<string, unknown> = {}) => ({
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

describe('ts#container#react-connection generator', () => {
  let tree: Tree;

  const writeService = (
    overrides: Record<string, unknown> = {},
    serve = true,
  ) => {
    tree.write(
      'packages/svc/project.json',
      JSON.stringify({
        name: 'svc',
        root: 'packages/svc',
        sourceRoot: 'packages/svc/src',
        targets: serve
          ? {
              'orders-serve': {
                executor: 'nx:run-commands',
                continuous: true,
              },
            }
          : {},
        metadata: { components: [component(overrides)] },
      }),
    );
  };

  const run = (overrides: Record<string, unknown> = {}) =>
    tsContainerReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'svc',
      targetComponent: component(overrides),
    });

  /** Run the generator and its callback, returning what the callback logged. */
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
      'apps/frontend/project.json',
      JSON.stringify({
        name: 'frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
        targets: { dev: { executor: 'nx:run-commands' } },
      }),
    );
    tree.write(
      'apps/frontend/package.json',
      JSON.stringify({ name: '@proj/frontend', type: 'module' }),
    );
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { RouterProvider } from '@tanstack/react-router';

const App = () => <RouterProvider router={router} />;

export function Main() {
  return <App />;
}
`,
    );
    writeService();
  });

  it.each(['iam', 'cognito', 'none'])(
    'should vend the %s hook',
    async (auth) => {
      writeService({ auth });
      await run({ auth });

      expect(tree.read(HOOK, 'utf-8')).toMatchSnapshot();
    },
  );

  it.each([
    ['iam', true],
    ['cognito', false],
    ['none', false],
  ])('should vend the sigv4 hook for %s: %s', async (auth, expected) => {
    writeService({ auth });
    await run({ auth });

    expect(tree.exists(SIGV4_HOOK)).toBe(expected);
  });

  it.each(['iam', 'cognito', 'none'])(
    'should add the %s dependencies to the website',
    async (auth) => {
      writeService({ auth });
      await run({ auth });

      const packageJson = readJson(tree, 'apps/frontend/package.json');
      expect({
        dependencies: packageJson.dependencies ?? {},
        devDependencies: packageJson.devDependencies ?? {},
      }).toMatchSnapshot();
    },
  );

  it('should point local dev at the serve target', async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'frontend').targets?.dev.dependsOn,
    ).toEqual([{ projects: ['svc'], target: 'orders-serve' }]);
    expect(tree.read(PROVIDER, 'utf-8')).toMatch(
      /runtimeConfig\.services = \{\s+\.\.\.runtimeConfig\.services,\s+Orders: 'http:\/\/localhost:8083',\s+\};/,
    );
  });

  it('should leave local dev alone when the service has no serve target', async () => {
    writeService({}, false);
    await run();

    expect(
      readProjectConfiguration(tree, 'frontend').targets?.dev.dependsOn,
    ).toBeUndefined();
    expect(tree.read(PROVIDER, 'utf-8')).not.toContain(
      'runtimeConfig.services',
    );
  });

  it('should vend the same hook for a py#container service', async () => {
    await run();
    const tsHook = tree.read(HOOK, 'utf-8');

    tree = createTreeUsingTsSolutionSetup();
    tree.write(
      'apps/frontend/project.json',
      JSON.stringify({
        name: 'frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
      }),
    );
    tree.write('apps/frontend/package.json', JSON.stringify({ name: 'fe' }));
    tree.write(
      'apps/frontend/src/main.tsx',
      'export function Main() {\n  return <App />;\n}\n',
    );
    writeService({ generator: 'py#container', path: 'svc/orders' });
    await run({ generator: 'py#container', path: 'svc/orders' });

    expect(tree.read(HOOK, 'utf-8')).toEqual(tsHook);
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
  ])('should reject %o', async (overrides, reason) => {
    writeService(overrides);

    await expect(run(overrides)).rejects.toThrow(
      `Cannot connect frontend to svc (orders): ${reason}`,
    );
  });

  describe('wiring message', () => {
    it('should print the CDK grant for iam', async () => {
      expect(await runAndCaptureInfo()).toEqual([
        `Let signed-in users of your website call the Orders container service. Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where orders is your Orders construct and identity is your UserIdentity construct. Until you add it, the service's HTTP API rejects the website's requests with 403 Forbidden.

orders.grantInvoke(identity.identityPool.authenticatedRole);`,
      ]);
    });

    it('should print the Terraform policy for iam', async () => {
      writeService({ iac: 'terraform' });

      expect(await runAndCaptureInfo({ iac: 'terraform' })).toEqual([
        `Let signed-in users of your website call the Orders container service. Add this to the root Terraform module that deploys the service, for example packages/infra/src/main.tf, where module "orders" deploys the service and module "user_identity" deploys your website's identity pool. Until you add it, the service's HTTP API rejects the website's requests with 403 Forbidden.

resource "aws_iam_role_policy" "authenticated_orders_invoke" {
  name = "authenticated-orders-invoke"
  role = module.user_identity.authenticated_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["execute-api:Invoke"]
        Resource = ["\${module.orders.api_execution_arn}/*"]
      },
    ]
  })
}`,
      ]);
    });

    it.each(['cognito', 'none'])(
      'should print nothing for %s',
      async (auth) => {
        writeService({ auth });

        expect(await runAndCaptureInfo({ auth })).toEqual([]);
      },
    );

    it.each(['cdk', 'terraform'] as const)(
      'should show the %s code in the guide',
      (iac) => {
        const names = {
          nameClassName: 'MyService',
          moduleName: 'my_service',
          variableName: 'myService',
        };
        const code =
          iac === 'cdk'
            ? cdkReactContainerWiring(names)
            : terraformReactContainerWiring(names);

        expect(readFileSync(GUIDE_FILE, 'utf-8')).toContain(code);
      },
    );
  });

  it('should record the connection on the website', async () => {
    await run({ auth: 'cognito' });

    expect(
      readProjectConfiguration(tree, 'frontend').metadata?.components,
    ).toContainEqual({
      generator: TS_CONTAINER_REACT_CONNECTION_GENERATOR_INFO.id,
      name: 'Orders',
      path: 'src/hooks/useOrders',
      auth: 'cognito',
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
      TS_CONTAINER_REACT_CONNECTION_GENERATOR_INFO.metric,
    );
  });
});
