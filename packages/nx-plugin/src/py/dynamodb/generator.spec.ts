/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { resolveContainers } from '../../utils/containers';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { readProjectConfigurationUnqualified } from '../../utils/nx';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { PY_DYNAMODB_GENERATOR_INFO, pyDynamoDBGenerator } from './generator';

vi.mock('../../utils/containers', () => ({
  resolveContainers: vi.fn(),
}));

describe('py#dynamodb generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(resolveContainers).mockResolvedValue('docker');
  });

  const defaultOptions = {
    name: 'MyTable',
    directory: 'packages',
    framework: 'pynamodb' as const,
    infra: 'dynamodb' as const,
    iac: 'cdk' as const,
  };

  it('should generate the dynamodb project', async () => {
    await pyDynamoDBGenerator(tree, defaultOptions);

    const projectConfig = readProjectConfigurationUnqualified(
      tree,
      'proj.my_table',
    );

    snapshotTreeDir(tree, 'packages/my_table/proj_my_table');
    snapshotTreeDir(tree, 'packages/common/scripts/src/dynamodb');

    expect(
      tree.read('packages/common/constructs/src/core/dynamodb.ts', 'utf-8'),
    ).toMatchSnapshot();
    expect(
      tree.read(
        'packages/common/constructs/src/app/dynamodb/my-table.ts',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read(
        'packages/common/constructs/src/app/dynamodb/index.ts',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toMatchSnapshot();

    expect(projectConfig.targets['pull-image']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command: 'tsx ../common/scripts/src/dynamodb/pull-image.ts',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets['dev']).toEqual({
      executor: 'nx:run-commands',
      continuous: true,
      dependsOn: ['pull-image'],
      options: {
        commands: [
          'tsx ../common/scripts/src/dynamodb/start-container.ts',
          'tsx ../common/scripts/src/dynamodb/create-local-table.ts',
        ],
        parallel: true,
        cwd: '{projectRoot}',
      },
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'proj.my_table:build',
    );

    expect(tree.exists('packages/my_table/config.json')).toBe(true);

    const pyprojectToml = tree.read(
      'packages/my_table/pyproject.toml',
      'utf-8',
    );
    expect(pyprojectToml).toContain('pynamodb');
    expect(pyprojectToml).toContain('boto3');
    expect(pyprojectToml).toContain('aws-lambda-powertools');
  });

  it('should generate scripts for finch engine', async () => {
    vi.mocked(resolveContainers).mockResolvedValue('finch');
    await pyDynamoDBGenerator(tree, defaultOptions);
    expect(
      tree.read('packages/my_table/config.json', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should generate terraform modules when iac is terraform', async () => {
    await pyDynamoDBGenerator(tree, {
      ...defaultOptions,
      iac: 'terraform',
    });
    expect(
      tree.read(
        'packages/common/terraform/src/core/dynamodb/dynamodb.tf',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read(
        'packages/common/terraform/src/app/dynamodb/my-table/my-table.tf',
        'utf-8',
      ),
    ).toMatchSnapshot();
    const sharedTerraformConfig = JSON.parse(
      tree.read('packages/common/terraform/project.json', 'utf-8') ?? '{}',
    );
    expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
      'proj.my_table:build',
    );
  });

  it('should keep an existing dynamodb app construct', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });
    tree.write(
      'packages/common/constructs/src/app/dynamodb/my-table.ts',
      '// preserve custom construct',
    );

    await pyDynamoDBGenerator(tree, defaultOptions);

    expect(
      tree
        .read(
          'packages/common/constructs/src/app/dynamodb/my-table.ts',
          'utf-8',
        )
        ?.trim(),
    ).toBe('// preserve custom construct');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await pyDynamoDBGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, PY_DYNAMODB_GENERATOR_INFO.metric);
  });

  it('should reuse port from existing py#dynamodb project', async () => {
    await pyDynamoDBGenerator(tree, defaultOptions);
    await pyDynamoDBGenerator(tree, { ...defaultOptions, name: 'OtherTable' });

    const firstConfig = readProjectConfigurationUnqualified(
      tree,
      'proj.my_table',
    );
    const secondConfig = readProjectConfigurationUnqualified(
      tree,
      'proj.other_table',
    );

    const portOf = (cfg: typeof firstConfig) =>
      (cfg.metadata as any)?.ports?.[0] as number | undefined;

    expect(portOf(secondConfig)).toBe(portOf(firstConfig));
    const secondConfigJson = JSON.parse(
      tree.read('packages/other_table/config.json', 'utf-8') ?? '{}',
    );
    expect(secondConfigJson.localDev.port).toBe(portOf(firstConfig));
  });

  it('should generate with infra=none then upgrade to infra=dynamodb', async () => {
    await pyDynamoDBGenerator(tree, { ...defaultOptions, infra: 'none' });

    snapshotTreeDir(tree, 'packages/my_table/proj_my_table');
    snapshotTreeDir(tree, 'packages/common/scripts/src/dynamodb');
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    const projectJson = JSON.parse(
      tree.read('packages/my_table/project.json', 'utf-8'),
    );
    expect(projectJson.targets['pull-image']).toBeDefined();
    expect(projectJson.targets['dev']).toBeDefined();

    await pyDynamoDBGenerator(tree, defaultOptions);

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
  });

  it('should be idempotent when re-run with same options', async () => {
    await pyDynamoDBGenerator(tree, defaultOptions);
    await pyDynamoDBGenerator(tree, defaultOptions);

    const projectConfig = readProjectConfigurationUnqualified(
      tree,
      'proj.my_table',
    );
    expect((projectConfig.metadata as any).ports).toHaveLength(1);

    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    const buildDeps = sharedConstructsConfig.targets.build.dependsOn as any[];
    expect(buildDeps.filter((d) => d === 'proj.my_table:build')).toHaveLength(
      1,
    );
  });

  it('should use custom tableName when provided', async () => {
    await pyDynamoDBGenerator(tree, {
      ...defaultOptions,
      tableName: 'CustomTableName',
    });
    const configJson = JSON.parse(
      tree.read('packages/my_table/config.json', 'utf-8') ?? '{}',
    );
    expect(configJson.localDev.containerName).toBe('proj-dynamodb');
    expect(tree.read('packages/my_table/config.json', 'utf-8')).toContain(
      '"tableName": "proj-custom-table-name"',
    );
  });
});
