/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger, readProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../../utils/metrics-assertions.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import {
  PY_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO,
  pyDynamoDBContainerConnectionGenerator,
} from './generator.js';
import {
  cdkDynamoDBContainerWiring,
  dataStoreNames,
  terraformDynamoDBContainerWiring,
} from './wiring.js';

// The callback installs packages, which needs a real workspace on disk.
vi.mock('../../../utils/install.js', () => ({
  installDependencies: vi.fn(),
}));

const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/connection/py-container-dynamodb.mdx',
);

const changedFiles = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

const service = (overrides: Record<string, unknown> = {}) => ({
  generator: 'py#container',
  name: 'reports',
  path: 'py_svc/reports',
  port: 8084,
  rc: 'Reports',
  infra: 'ecs',
  iac: 'cdk',
  ...overrides,
});

describe('py#dynamodb#container-connection generator', () => {
  let tree: Tree;

  const run = (overrides: Record<string, unknown> = {}) =>
    pyDynamoDBContainerConnectionGenerator(tree, {
      sourceProject: 'proj.py_svc',
      targetProject: 'proj.my_table',
      sourceComponent: service(overrides),
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
      'packages/py-svc/project.json',
      JSON.stringify({
        name: 'proj.py_svc',
        root: 'packages/py-svc',
        sourceRoot: 'packages/py-svc/py_svc',
        targets: {
          'reports-serve': { executor: 'nx:run-commands', continuous: true },
        },
        metadata: { components: [service()] },
      }),
    );
    tree.write(
      'packages/py-svc/pyproject.toml',
      `[project]
name = "proj.py_svc"
version = "1.0.0"
dependencies = []
`,
    );
    tree.write(
      'packages/my-table/project.json',
      JSON.stringify({
        name: 'proj.my_table',
        root: 'packages/my-table',
        targets: { dev: { executor: 'nx:run-commands', continuous: true } },
      }),
    );
    tree.write(
      'packages/my-table/pyproject.toml',
      `[project]
name = "proj.my_table"
version = "1.0.0"
dependencies = []
`,
    );
  });

  it('should add the table package as a workspace dependency', async () => {
    await run();

    expect(tree.read('packages/py-svc/pyproject.toml', 'utf-8')).toContain(
      'dependencies = [ "proj-my-table" ]',
    );
  });

  it("should start the table with the service's serve target", async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'proj.py_svc').targets?.['reports-serve']
        .dependsOn,
    ).toEqual([{ projects: ['proj.my_table'], target: 'dev' }]);
  });

  it('should change nothing on a second run', async () => {
    await run();
    const first = changedFiles(tree);

    await run();

    expect(changedFiles(tree)).toEqual(first);
  });

  it('should reject a service with no infrastructure', async () => {
    await expect(run({ infra: 'none' })).rejects.toThrow(
      "Cannot connect proj.py_svc (reports) to proj.my_table: Access is granted to the container service's ECS task role, which only infra ecs creates.",
    );
  });

  describe('wiring message', () => {
    it('should print the CDK grant', async () => {
      const [message, ...rest] = await runAndCaptureInfo();

      expect(rest).toEqual([]);
      expect(message).toMatch(
        /\n\nmyTable\.grantReadWriteData\(reports\.taskRole\);$/,
      );
    });

    it('should print the Terraform policy', async () => {
      const [message] = await runAndCaptureInfo({ iac: 'terraform' });

      expect(message).toContain(
        terraformDynamoDBContainerWiring(
          {
            nameClassName: 'Reports',
            nameKebabCase: 'reports',
            moduleName: 'reports',
            variableName: 'reports',
          },
          dataStoreNames('proj.my_table'),
        ),
      );
    });

    it.each(['cdk', 'terraform'] as const)(
      'should show the %s code in the guide',
      (iac) => {
        const serviceNames = {
          nameClassName: 'MyService',
          nameKebabCase: 'my-service',
          moduleName: 'my_service',
          variableName: 'myService',
        };
        const table = dataStoreNames('my_scope.my_table');
        const code =
          iac === 'cdk'
            ? cdkDynamoDBContainerWiring(serviceNames, table)
            : terraformDynamoDBContainerWiring(serviceNames, table);

        expect(readFileSync(GUIDE_FILE, 'utf-8')).toContain(code);
      },
    );
  });

  it('should record the connection on the service project', async () => {
    await run();

    expect(
      readProjectConfiguration(tree, 'proj.py_svc').metadata?.components,
    ).toContainEqual({
      generator: PY_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO.id,
      name: 'reports-proj.my_table',
      path: 'packages/my-table',
      sourcePath: 'py_svc/reports',
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
      PY_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO.metric,
    );
  });
});
