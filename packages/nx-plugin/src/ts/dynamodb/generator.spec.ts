/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { tsDynamoDBGenerator, TS_DYNAMODB_GENERATOR_INFO } from './generator';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { readProjectConfigurationUnqualified } from '../../utils/nx';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('ts#dynamodb generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const defaultOptions = {
    name: 'MyTable',
    directory: 'packages',
    iacProvider: 'CDK' as const,
  };

  it('should generate the dynamodb project', async () => {
    await tsDynamoDBGenerator(tree, defaultOptions);
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    const projectConfig = readProjectConfigurationUnqualified(
      tree,
      '@proj/my-table',
    );

    snapshotTreeDir(tree, 'packages/my-table/src');
    snapshotTreeDir(tree, 'packages/my-table/scripts');

    expect(
      tree.read(
        'packages/common/constructs/src/core/dynamodb.ts',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read(
        'packages/common/constructs/src/app/dynamodb-tables/my-table.ts',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read(
        'packages/common/constructs/src/app/dynamodb-tables/index.ts',
        'utf-8',
      ),
    ).toMatchSnapshot();
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toMatchSnapshot();

    expect(projectConfig.targets['docker-pull']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command:
          'tsx scripts/docker-pull.ts public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:latest',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets['serve-local']).toEqual({
      executor: 'nx:run-commands',
      options: {
        command:
          'tsx scripts/docker-start.ts proj-dynamodb public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:latest 8000',
        cwd: '{projectRoot}',
      },
      continuous: true,
      dependsOn: ['docker-pull'],
    });
    expect(projectConfig.targets['create-local-table']).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['serve-local'],
      options: {
        command: 'tsx scripts/create-table.ts proj-my-table 8000',
        cwd: '{projectRoot}',
      },
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8') ?? '{}',
    );
    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      '@proj/my-table:build',
    );

    expect(packageJson.dependencies['@aws-sdk/client-dynamodb']).toBeDefined();
    expect(packageJson.dependencies['electrodb']).toBeDefined();
    expect(packageJson.devDependencies['tsx']).toBeDefined();
    expect(packageJson.devDependencies['dockerode']).toBeDefined();
    expect(packageJson.devDependencies['@types/dockerode']).toBeDefined();
    expect(packageJson.devDependencies['@types/aws-lambda']).toBeDefined();
  });

  it('should generate terraform modules when iacProvider is Terraform', async () => {
    await tsDynamoDBGenerator(tree, {
      ...defaultOptions,
      iacProvider: 'Terraform',
    });
    expect(
      tree.read(
        'packages/common/terraform/src/app/dynamodb-tables/my-table/my-table.tf',
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
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
    tree.write(
      'packages/common/constructs/src/app/dynamodb-tables/my-table.ts',
      '// preserve custom construct',
    );

    await tsDynamoDBGenerator(tree, defaultOptions);

    expect(
      tree
        .read(
          'packages/common/constructs/src/app/dynamodb-tables/my-table.ts',
          'utf-8',
        )
        ?.trim(),
    ).toBe('// preserve custom construct');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await tsDynamoDBGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, TS_DYNAMODB_GENERATOR_INFO.metric);
  });

  it('should use custom tableName when provided', async () => {
    await tsDynamoDBGenerator(tree, {
      ...defaultOptions,
      tableName: 'CustomTableName',
    });
    const projectConfig = readProjectConfigurationUnqualified(
      tree,
      '@proj/my-table',
    );

    expect(projectConfig.targets['serve-local'].options.command).toContain(
      'proj-dynamodb',
    );
    expect(
      tree.read('packages/my-table/src/constants.ts', 'utf-8'),
    ).toContain("LOCAL_TABLE_NAME = 'proj-custom-table-name'");
  });
});
