/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger, readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cdkAgentContainerWiring,
  terraformAgentContainerWiring,
} from '../../../ts/agent/container-connection/wiring.js';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../../utils/metrics-assertions.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import {
  PY_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO,
  pyAgentContainerConnectionGenerator,
} from './generator.js';

// The callback installs packages, which needs a real workspace on disk.
vi.mock('../../../utils/install.js', () => ({
  installDependencies: vi.fn(),
}));

const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/connection/py-agent-container.mdx',
);
const MODULE_DIR = 'packages/common/agent_connection/test_agent_connection';
const CLIENT = `${MODULE_DIR}/app/reports_client.py`;

const changedFiles = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

const AGENT = {
  generator: 'py#agent',
  name: 'pyhelper',
  path: 'py_agents/pyhelper',
  port: 8082,
  rc: 'Pyhelper',
  auth: 'iam',
  protocol: 'http',
};

const service = (overrides: Record<string, unknown> = {}) => ({
  generator: 'py#container',
  name: 'reports',
  path: 'py_svc/reports',
  port: 8084,
  rc: 'Reports',
  infra: 'ecs',
  ingress: 'http-api',
  auth: 'iam',
  iac: 'cdk',
  ...overrides,
});

describe('py#agent#container-connection generator', () => {
  let tree: Tree;

  const writeService = (overrides: Record<string, unknown> = {}) =>
    tree.write(
      'packages/py-svc/project.json',
      JSON.stringify({
        name: 'test.py_svc',
        root: 'packages/py-svc',
        sourceRoot: 'packages/py-svc/py_svc',
        targets: {
          'reports-serve': { executor: 'nx:run-commands', continuous: true },
        },
        metadata: { components: [service(overrides)] },
      }),
    );

  const run = (overrides: Record<string, unknown> = {}) =>
    pyAgentContainerConnectionGenerator(tree, {
      sourceProject: 'test.py_agents',
      targetProject: 'test.py_svc',
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
    tree.write('package.json', JSON.stringify({ name: '@test/source' }));
    tree.write(
      'packages/py-agents/project.json',
      JSON.stringify({
        name: 'test.py_agents',
        root: 'packages/py-agents',
        sourceRoot: 'packages/py-agents/py_agents',
        targets: {
          'pyhelper-dev': { executor: 'nx:run-commands', continuous: true },
        },
        metadata: { components: [AGENT] },
      }),
    );
    tree.write(
      'packages/py-agents/pyproject.toml',
      `[project]
name = "test.py_agents"
version = "1.0.0"
dependencies = ["strands-agents"]
`,
    );
    writeService();
  });

  it('should vend the client into the agent_connection project', async () => {
    await run();

    expect(tree.read(CLIENT, 'utf-8')).toMatchSnapshot();
    expect(tree.read(`${MODULE_DIR}/__init__.py`, 'utf-8')).toContain(
      'from .app.reports_client import get_reports_client',
    );
    expect(tree.exists(`${MODULE_DIR}/app/__init__.py`)).toBe(true);
  });

  it('should add the client packages to the agent_connection project', async () => {
    await run();

    const pyproject = tree.read(
      'packages/common/agent_connection/pyproject.toml',
      'utf-8',
    );
    for (const dep of ['httpx', 'boto3', 'aws-lambda-powertools']) {
      expect(pyproject).toMatch(new RegExp(`"${dep}==`));
    }
  });

  it('should make the agent depend on the agent_connection project', async () => {
    await run();

    expect(tree.read('packages/py-agents/pyproject.toml', 'utf-8')).toContain(
      '"test-agent-connection"',
    );
  });

  it("should start the service with the agent's dev target", async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'test.py_agents').targets?.['pyhelper-dev']
        .dependsOn,
    ).toEqual([{ projects: ['test.py_svc'], target: 'reports-serve' }]);
  });

  it('should vend the same client for a ts#container service', async () => {
    await run();
    const pyClient = tree.read(CLIENT, 'utf-8');

    writeService({ generator: 'ts#container', path: 'src/reports' });
    tree.delete(CLIENT);
    await run({ generator: 'ts#container', path: 'src/reports' });

    expect(tree.read(CLIENT, 'utf-8')).toEqual(pyClient);
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
      `Cannot connect test.py_agents (pyhelper) to test.py_svc (reports): ${reason}`,
    );
  });

  describe('wiring message', () => {
    it('should print the CDK grant', async () => {
      const [message, ...rest] = await runAndCaptureInfo();

      expect(rest).toEqual([]);
      expect(message).toContain(
        'Let the Pyhelper agent call the Reports container service.',
      );
      expect(message).toMatch(/\n\nreports\.grantInvoke\(pyhelper\);$/);
    });

    it('should print the Terraform policy statement', async () => {
      const [message] = await runAndCaptureInfo({ iac: 'terraform' });

      expect(message).toContain(
        'source = "../../common/terraform/src/app/agents/pyhelper"',
      );
      expect(message).toContain(
        `Resource = ["\${module.reports.api_execution_arn}/*"]`,
      );
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
      readProjectConfiguration(tree, 'test.py_agents').metadata?.components,
    ).toContainEqual({
      generator: PY_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO.id,
      name: 'pyhelper-Reports',
      path: 'packages/py-svc/py_svc/reports',
      sourcePath: 'py_agents/pyhelper',
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
      PY_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO.metric,
    );
  });
});
