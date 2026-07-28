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
import { TS_DYNAMODB_GENERATOR_INFO, tsDynamoDBGenerator } from './generator';

vi.mock('../../utils/containers', () => ({
  resolveContainers: vi.fn(),
}));

describe('ts#dynamodb generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(resolveContainers).mockResolvedValue('docker');
  });

  const defaultOptions = {
    name: 'MyTable',
    directory: 'packages',
    framework: 'electrodb' as const,
    infra: 'dynamodb' as const,
    iac: 'cdk' as const,
  };

  it('should generate the dynamodb project', async () => {
    await tsDynamoDBGenerator(tree, defaultOptions);
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    const projectConfig = readProjectConfigurationUnqualified(
      tree,
      '@proj/my-table',
    );

    snapshotTreeDir(tree, 'packages/my-table/src');
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
      '@proj/my-table:build',
    );

    expect(tree.exists('packages/my-table/config.json')).toBe(true);

    // Runtime dependencies (and the @types/* backing type imports) land in the
    // project's own manifest as catalog references
    const projectPackageJson = JSON.parse(
      tree.read('packages/my-table/package.json', 'utf-8') ?? '{}',
    );
    expect(projectPackageJson.dependencies['@aws-sdk/client-dynamodb']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.dependencies['electrodb']).toBe('catalog:');
    expect(
      projectPackageJson.dependencies['@aws-lambda-powertools/parameters'],
    ).toBe('catalog:');
    expect(
      projectPackageJson.dependencies['@aws-sdk/client-appconfigdata'],
    ).toBe('catalog:');
    expect(projectPackageJson.devDependencies['@types/aws-lambda']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.devDependencies['@types/node']).toBe('catalog:');

    // Pure build/test tooling stays in the workspace root devDependencies
    expect(packageJson.devDependencies['tsx']).toBeDefined();
  });

  it('should generate scripts for finch engine', async () => {
    vi.mocked(resolveContainers).mockResolvedValue('finch');
    await tsDynamoDBGenerator(tree, defaultOptions);
    expect(
      tree.read('packages/my-table/config.json', 'utf-8'),
    ).toMatchSnapshot();
  });

  it('should generate terraform modules when iac is terraform', async () => {
    await tsDynamoDBGenerator(tree, {
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
      '@proj/my-table:build',
    );
  });

  it('should keep an existing dynamodb app construct', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });
    tree.write(
      'packages/common/constructs/src/app/dynamodb/my-table.ts',
      '// preserve custom construct',
    );

    await tsDynamoDBGenerator(tree, defaultOptions);

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

    await tsDynamoDBGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, TS_DYNAMODB_GENERATOR_INFO.metric);
  });

  it('should reuse port from existing ts#dynamodb project', async () => {
    await tsDynamoDBGenerator(tree, defaultOptions);
    await tsDynamoDBGenerator(tree, { ...defaultOptions, name: 'OtherTable' });

    const firstConfig = readProjectConfigurationUnqualified(
      tree,
      '@proj/my-table',
    );
    const secondConfig = readProjectConfigurationUnqualified(
      tree,
      '@proj/other-table',
    );

    const portOf = (cfg: typeof firstConfig) =>
      (cfg.metadata as any)?.ports?.[0] as number | undefined;

    expect(portOf(secondConfig)).toBe(portOf(firstConfig));
    const secondConfigJson = JSON.parse(
      tree.read('packages/other-table/config.json', 'utf-8') ?? '{}',
    );
    expect(secondConfigJson.localDev.port).toBe(portOf(firstConfig));
  });

  it('should generate with infra=none then upgrade to infra=dynamodb', async () => {
    await tsDynamoDBGenerator(tree, { ...defaultOptions, infra: 'none' });

    snapshotTreeDir(tree, 'packages/my-table/src');
    snapshotTreeDir(tree, 'packages/common/scripts/src/dynamodb');
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    const projectJson = JSON.parse(
      tree.read('packages/my-table/project.json', 'utf-8'),
    );
    expect(projectJson.targets['pull-image']).toBeDefined();
    expect(projectJson.targets['dev']).toBeDefined();

    await tsDynamoDBGenerator(tree, defaultOptions);

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
  });

  it('should be idempotent when re-run with same options', async () => {
    await tsDynamoDBGenerator(tree, defaultOptions);
    await tsDynamoDBGenerator(tree, defaultOptions);

    const projectConfig = readProjectConfigurationUnqualified(
      tree,
      '@proj/my-table',
    );
    expect((projectConfig.metadata as any).ports).toHaveLength(1);

    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    const buildDeps = sharedConstructsConfig.targets.build.dependsOn as any[];
    expect(buildDeps.filter((d) => d === '@proj/my-table:build')).toHaveLength(
      1,
    );
  });

  it('should use custom tableName when provided', async () => {
    await tsDynamoDBGenerator(tree, {
      ...defaultOptions,
      tableName: 'CustomTableName',
    });
    const configJson = JSON.parse(
      tree.read('packages/my-table/config.json', 'utf-8') ?? '{}',
    );
    expect(configJson.localDev.containerName).toBe('proj-dynamodb');
    expect(tree.read('packages/my-table/config.json', 'utf-8')).toContain(
      '"tableName": "proj-custom-table-name"',
    );
  });
});
