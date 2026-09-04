/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { resolveContainers } from '../../utils/containers.js';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../utils/metrics.spec.js';
import { readProjectConfigurationUnqualified } from '../../utils/nx.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test.js';
import {
  PY_DYNAMODB_GENERATOR_INFO,
  pyDynamoDBGenerator,
} from './generator.js';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

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
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );
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
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );

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

    // The barrels keep exactly one import of each generated model.
    const entitiesInit = tree.read(
      'packages/my_table/proj_my_table/entities/__init__.py',
      'utf-8',
    );
    expect(entitiesInit.match(/BaseModel/g)).toHaveLength(2); // import + __all__
    expect(entitiesInit.match(/ExampleModel/g)).toHaveLength(2);
  });

  it('should preserve the entities and GSIs the user authored', async () => {
    await pyDynamoDBGenerator(tree, defaultOptions);

    // Follow the guide's "Storing Multiple Entity Types" section, then its
    // "Export the new entities from __init__.py" step.
    const orderModel = `from .base import BaseModel\n\n\nclass OrderModel(BaseModel):\n    pass\n`;
    tree.write('packages/my_table/proj_my_table/entities/order.py', orderModel);
    tree.write(
      'packages/my_table/proj_my_table/entities/__init__.py',
      `from .base import BaseModel\nfrom .example import ExampleModel\nfrom .order import OrderModel\n\n__all__ = ["BaseModel", "ExampleModel", "OrderModel"]\n`,
    );
    // Reflect a third GSI in base.py, as the GSI section instructs.
    const editedBase = `# my base model\n`;
    tree.write('packages/my_table/proj_my_table/entities/base.py', editedBase);
    const configPath = 'packages/my_table/config.json';
    const config = JSON.parse(tree.read(configPath, 'utf-8'));
    config.tableConfig.globalSecondaryIndexes.push({
      indexName: 'gsi3pk-gsi3sk-index',
      partitionKey: 'gsi3pk',
      sortKey: 'gsi3sk',
    });
    tree.write(configPath, JSON.stringify(config, null, 2));

    await pyDynamoDBGenerator(tree, defaultOptions);

    expect(
      tree.read('packages/my_table/proj_my_table/entities/order.py', 'utf-8'),
    ).toBe(orderModel);
    expect(
      tree.read('packages/my_table/proj_my_table/entities/base.py', 'utf-8'),
    ).toBe(editedBase);
    const entitiesInit = tree.read(
      'packages/my_table/proj_my_table/entities/__init__.py',
      'utf-8',
    );
    expect(entitiesInit).toContain('OrderModel');
    expect(entitiesInit).toContain('BaseModel');
    expect(entitiesInit).toContain('ExampleModel');
    expect(
      JSON.parse(
        tree.read(configPath, 'utf-8'),
      ).tableConfig.globalSecondaryIndexes.map(
        (gsi: { indexName: string }) => gsi.indexName,
      ),
    ).toEqual([
      'gsi1pk-gsi1sk-index',
      'gsi2pk-gsi2sk-index',
      'gsi3pk-gsi3sk-index',
    ]);
  });

  it('should register a removed model import back into a curated barrel', async () => {
    // The barrel is merged rather than replaced, so the generated models are
    // re-registered — which PynamoDB needs for their discriminators — without
    // discarding the user's own imports.
    await pyDynamoDBGenerator(tree, defaultOptions);
    tree.write(
      'packages/my_table/proj_my_table/entities/__init__.py',
      `from .order import OrderModel\n\n__all__ = ["OrderModel"]\n`,
    );

    await pyDynamoDBGenerator(tree, defaultOptions);

    const entitiesInit = tree.read(
      'packages/my_table/proj_my_table/entities/__init__.py',
      'utf-8',
    );
    expect(entitiesInit).toContain('OrderModel');
    expect(entitiesInit).toContain('BaseModel');
    expect(entitiesInit).toContain('ExampleModel');
  });

  it('should converge the framework-owned config values on a re-run', async () => {
    // The localDev block is derived from the generator's options, so changing
    // them takes effect while the user's GSI list is carried through.
    await pyDynamoDBGenerator(tree, defaultOptions);
    const configPath = 'packages/my_table/config.json';
    const config = JSON.parse(tree.read(configPath, 'utf-8'));
    config.tableConfig.globalSecondaryIndexes.push({
      indexName: 'gsi3pk-gsi3sk-index',
      partitionKey: 'gsi3pk',
    });
    tree.write(configPath, JSON.stringify(config, null, 2));

    await pyDynamoDBGenerator(tree, {
      ...defaultOptions,
      tableName: 'RenamedTable',
    });

    const updated = JSON.parse(tree.read(configPath, 'utf-8'));
    expect(updated.localDev.tableName).toBe('proj-renamed-table');
    expect(updated.tableConfig.globalSecondaryIndexes).toHaveLength(3);
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
