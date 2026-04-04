/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, Tree } from '@nx/devkit';
import { tsRdbGenerator, TS_RDB_GENERATOR_INFO } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { METRICS_ASPECT_FILE_PATH } from '../../utils/metrics';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { readProjectConfigurationUnqualified } from '../../utils/nx';

const expectHasMetricTags = (tree: Tree, ...metrics: string[]) => {
  const content = tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8');
  expect(content).toBeTruthy();

  const tagsMatch = content!.match(
    /const tags:\s*string\[\]\s*=\s*\[([^\]]*)\]/,
  );
  expect(tagsMatch).toBeTruthy();

  const tagsContent = tagsMatch![1];
  const tags = tagsContent
    ? (tagsContent.match(/'([^']*)'/g)?.map((t) => t.slice(1, -1)) ?? [])
    : [];

  expect(tags).toEqual(expect.arrayContaining(metrics));
};

describe('ts#rdb generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const defaultOptions = {
    name: 'db',
    directory: 'packages',
    service: 'Aurora' as const,
    engine: 'Postgres' as const,
    databaseUser: 'databaseUser',
    databaseName: 'databaseName',
    ormFramework: 'Prisma' as const,
  };

  it('should generate the aurora shared construct', async () => {
    await tsRdbGenerator(tree, defaultOptions);
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    const projectConfig = readProjectConfigurationUnqualified(tree, '@proj/db');

    expect(
      tree.exists('packages/common/constructs/src/core/rdb/aurora.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/dbs/db.ts'),
    ).toBeTruthy();
    expect(tree.exists('packages/db/lib/prisma.ts')).toBeTruthy();
    expect(tree.exists('packages/db/prisma.config.ts')).toBeTruthy();
    expect(tree.exists('packages/db/prisma/schema.prisma')).toBeTruthy();
    expect(tree.exists('packages/db/src/index.ts')).toBeTruthy();
    expect(tree.exists('packages/db/Dockerfile')).toBeTruthy();
    expect(tree.exists('packages/db/tsconfig.lib.json')).toBeTruthy();
    expect(tree.exists('packages/db/eslint.config.mjs')).toBeTruthy();
    expect(tree.exists('packages/db/src/migration-handler.ts')).toBeTruthy();
    expect(
      tree.read('packages/common/constructs/src/core/rdb/aurora.ts', 'utf-8'),
    ).toContain('export class Aurora');
    expect(
      tree.read('packages/common/constructs/src/app/dbs/db.ts', 'utf-8'),
    ).toContain('export class Db');
    expect(
      tree.read('packages/common/constructs/src/app/dbs/db.ts', 'utf-8'),
    ).toContain(
      "const { databaseName = 'databaseName', vpc, ...restProps } = props;",
    );
    expect(
      tree.read('packages/common/constructs/src/app/dbs/db.ts', 'utf-8'),
    ).toContain("databaseUser: 'databaseUser'");
    expect(tree.read('packages/db/lib/prisma.ts', 'utf-8')).toContain(
      "import { PrismaPg } from '@prisma/adapter-pg';",
    );
    expect(tree.read('packages/db/lib/prisma.ts', 'utf-8')).toContain(
      'connectionString: `${process.env.DATABASE_URL}`',
    );
    expect(tree.read('packages/db/prisma.config.ts', 'utf-8')).toContain(
      "import { defineConfig } from 'prisma/config';",
    );
    expect(tree.read('packages/db/prisma/schema.prisma', 'utf-8')).toContain(
      'model ExampleTable',
    );
    expect(tree.read('packages/db/prisma/schema.prisma', 'utf-8')).toContain(
      'title String',
    );
    expect(tree.read('packages/db/src/index.ts', 'utf-8')?.trim()).toBe(
      "export { prisma } from '../lib/prisma.js';",
    );
    expect(tree.read('packages/db/Dockerfile', 'utf-8')).toContain(
      '"prisma":"7.6.0"',
    );
    expect(
      JSON.parse(tree.read('packages/db/tsconfig.lib.json', 'utf-8') ?? '{}')
        .include,
    ).toEqual(['src/**/*.ts', 'lib/**/*.ts', 'generated/prisma/**/*.ts']);
    expect(tree.read('packages/db/eslint.config.mjs', 'utf-8')).toContain(
      "'**/generated/**'",
    );
    expect(tree.read('packages/db/eslint.config.mjs', 'utf-8')).toContain(
      "'**/out-tsc'",
    );
    expect(
      tree.read('packages/common/constructs/src/app/dbs/db.ts', 'utf-8'),
    ).toContain('../../../../../../dist/packages/db/bundle/migration');
    expect(
      tree.read('packages/common/constructs/src/core/index.ts', 'utf-8'),
    ).toContain('./rdb/aurora.js');
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain('./dbs/index.js');
    expect(
      tree.read('packages/common/constructs/src/app/dbs/index.ts', 'utf-8'),
    ).toContain('./db.js');
    expect(tree.read('packages/db/rolldown.config.ts', 'utf-8')).toContain(
      "input: 'src/migration-handler.ts'",
    );
    expect(tree.read('packages/db/rolldown.config.ts', 'utf-8')).toContain(
      "file: '../../dist/packages/db/bundle/migration/index.js'",
    );
    expect(projectConfig.targets.bundle).toEqual({
      cache: true,
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle'],
      executor: 'nx:run-commands',
      options: {
        command: 'rolldown -c rolldown.config.ts',
        cwd: '{projectRoot}',
      },
      dependsOn: ['compile', 'bundle-migration'],
    });
    expect(projectConfig.targets['bundle-migration']).toEqual({
      cache: true,
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle/migration'],
      options: {
        commands: [
          'rimraf ../../dist/{projectRoot}/bundle/migration',
          'make-dir ../../dist/{projectRoot}/bundle/migration',
          'ncp prisma ../../dist/{projectRoot}/bundle/migration/prisma',
          'ncp prisma.config.ts ../../dist/{projectRoot}/bundle/migration/prisma.config.ts',
          'ncp Dockerfile ../../dist/{projectRoot}/bundle/migration/Dockerfile',
        ],
        cwd: '{projectRoot}',
        parallel: false,
      },
    });
    expect(projectConfig.targets.generate).toEqual({
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/{projectRoot}/tsc'],
      options: {
        command: 'prisma generate',
        cwd: '{projectRoot}',
      },
    });
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    expect(projectConfig.targets.build.dependsOn).not.toContain(
      'bundle-migration',
    );
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');
    expect(packageJson.dependencies['@prisma/adapter-pg']).toBe('7.6.0');
    expect(packageJson.dependencies['@prisma/client']).toBe('7.6.0');
    expect(packageJson.dependencies.pg).toBe('8.20.0');
    expect(packageJson.dependencies['@prisma/adapter-mariadb']).toBeUndefined();
    expect(packageJson.devDependencies.prisma).toBe('7.6.0');
    expect(packageJson.devDependencies.ncp).toBe('2.0.0');
    expect(packageJson.devDependencies.rimraf).toBe('6.1.3');
    expect(packageJson.devDependencies['make-dir-cli']).toBe('4.0.0');
  });

  it('should add mysql prisma dependencies when engine is MySQL', async () => {
    await tsRdbGenerator(tree, {
      ...defaultOptions,
      engine: 'MySQL',
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8') ?? '{}');
    const prismaFile = tree.read('packages/db/lib/prisma.ts', 'utf-8');
    const prismaSchema = tree.read('packages/db/prisma/schema.prisma', 'utf-8');

    expect(packageJson.dependencies['@prisma/adapter-mariadb']).toBe('7.6.0');
    expect(packageJson.dependencies['@prisma/client']).toBe('7.6.0');
    expect(packageJson.dependencies['@prisma/adapter-pg']).toBeUndefined();
    expect(packageJson.dependencies.pg).toBeUndefined();
    expect(packageJson.devDependencies.prisma).toBe('7.6.0');
    expect(packageJson.devDependencies.ncp).toBe('2.0.0');
    expect(packageJson.devDependencies.rimraf).toBe('6.1.3');
    expect(packageJson.devDependencies['make-dir-cli']).toBe('4.0.0');
    expect(prismaFile).toContain(
      "import { PrismaMariaDb } from '@prisma/adapter-mariadb';",
    );
    expect(prismaFile).toContain(
      'connectionString: `${process.env.DATABASE_URL}`',
    );
    expect(prismaSchema).toContain('provider = "mysql"');
  });

  it('should keep an existing aurora shared construct', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
    tree.write(
      'packages/common/constructs/src/core/rdb/aurora.ts',
      '// preserve custom aurora construct',
    );

    await tsRdbGenerator(tree, defaultOptions);

    expect(
      tree
        .read('packages/common/constructs/src/core/rdb/aurora.ts', 'utf-8')
        ?.trim(),
    ).toBe('// preserve custom aurora construct');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await tsRdbGenerator(tree, defaultOptions);

    expectHasMetricTags(tree, TS_RDB_GENERATOR_INFO.metric);
  });
});
