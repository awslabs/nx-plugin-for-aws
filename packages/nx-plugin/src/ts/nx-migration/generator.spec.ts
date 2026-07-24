/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  NX_MIGRATION_GENERATOR_INFO,
  tsNxMigrationGenerator,
} from './generator';

describe('nx-migration generator', () => {
  describe('within @aws/nx-plugin', () => {
    let tree: Tree;
    const PROJECT = '@aws/nx-plugin';
    const MIGRATIONS_JSON = 'packages/nx-plugin/migrations.json';
    const dir = (file: string) =>
      `packages/nx-plugin/src/migrations/rename-foo-target/${file}`;

    beforeEach(() => {
      tree = createTreeUsingTsSolutionSetup();

      // Root package.json marks this as the plugin repo itself
      updateJson(tree, 'package.json', (json) => ({
        ...json,
        name: '@aws/nx-plugin-source',
        type: 'module',
      }));

      addProjectConfiguration(tree, PROJECT, {
        root: 'packages/nx-plugin',
        sourceRoot: 'packages/nx-plugin/src',
      });
      writeJson(tree, 'packages/nx-plugin/tsconfig.json', {});
      writeJson(tree, 'packages/nx-plugin/package.json', {
        name: '@aws/nx-plugin',
        'nx-migrations': { migrations: './migrations.json' },
      });
      writeJson(tree, MIGRATIONS_JSON, {
        $schema: 'http://json-schema.org/schema',
        name: '@aws/nx-plugin',
        generators: {},
      });
    });

    it('should scaffold a deterministic migration and its test by default', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      expect(tree.exists(dir('migration.ts'))).toBeTruthy();
      expect(tree.exists(dir('migration.spec.ts'))).toBeTruthy();
      expect(tree.exists(dir('prompt.md'))).toBeFalsy();
    });

    it('should register a deterministic migration with implementation only, no version', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['rename-foo-target']).toEqual({
        description: 'Rename the foo target to bar',
        implementation: './src/migrations/rename-foo-target/migration',
      });
      expect(
        migrations.generators['rename-foo-target'].version,
      ).toBeUndefined();
    });

    it('should scaffold an agentic migration as a prompt only', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        kind: 'agentic',
      });

      expect(tree.exists(dir('prompt.md'))).toBeTruthy();
      expect(tree.exists(dir('migration.ts'))).toBeFalsy();
      expect(tree.exists(dir('migration.spec.ts'))).toBeFalsy();

      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['rename-foo-target']).toEqual({
        description: 'Rename the foo target to bar',
        prompt: './src/migrations/rename-foo-target/prompt.md',
      });
    });

    it('should scaffold a hybrid migration with both implementation and prompt', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        kind: 'hybrid',
      });

      expect(tree.exists(dir('migration.ts'))).toBeTruthy();
      expect(tree.exists(dir('migration.spec.ts'))).toBeTruthy();
      expect(tree.exists(dir('prompt.md'))).toBeTruthy();

      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['rename-foo-target']).toEqual({
        description: 'Rename the foo target to bar',
        implementation: './src/migrations/rename-foo-target/migration',
        prompt: './src/migrations/rename-foo-target/prompt.md',
      });
    });

    it('should return agentContext from a hybrid migration skeleton', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        kind: 'hybrid',
      });

      const migration = tree.read(dir('migration.ts'), 'utf-8');
      expect(migration).toContain('agentContext');
    });

    it('should not return agentContext from a deterministic migration skeleton', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      const migration = tree.read(dir('migration.ts'), 'utf-8');
      expect(migration).not.toContain('agentContext');
    });

    it('should link the Nx migration docs and MigrationReturnObject', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      const migration = tree.read(dir('migration.ts'), 'utf-8');
      expect(migration).toContain('nx.dev/docs/kb/migration-generators');
      expect(migration).toContain(
        'nx.dev/docs/reference/devkit/MigrationReturnObject',
      );
    });

    it('should kebab-case the migration name', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'Rename Foo Target',
        description: 'Rename the foo target to bar',
      });

      expect(tree.exists(dir('migration.ts'))).toBeTruthy();
      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['rename-foo-target']).toBeDefined();
    });

    it('should reference the migration description in the scaffolded file', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      const migration = tree.read(dir('migration.ts'), 'utf-8');
      expect(migration).toContain('Rename the foo target to bar');
      expect(migration).toContain('MigrationReturnObject');
    });

    it('should not overwrite an existing migration implementation', async () => {
      tree.write(dir('migration.ts'), '// custom implementation');

      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      expect(tree.read(dir('migration.ts'), 'utf-8')).toContain(
        '// custom implementation',
      );
    });

    it('should preserve existing migrations.json entries', async () => {
      writeJson(tree, MIGRATIONS_JSON, {
        $schema: 'http://json-schema.org/schema',
        name: '@aws/nx-plugin',
        generators: {
          'existing-migration': {
            description: 'Existing',
            implementation: './src/migrations/existing-migration/migration',
          },
        },
      });

      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['existing-migration']).toBeDefined();
      expect(migrations.generators['rename-foo-target']).toBeDefined();
    });

    it('should not add @nx/devkit to the plugin repo package.json', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      const pkg = JSON.parse(
        tree.read('packages/nx-plugin/package.json', 'utf-8'),
      );
      expect(pkg.dependencies?.['@nx/devkit']).toBeUndefined();
    });

    it('should add generator metric tags', async () => {
      await sharedConstructsGenerator(tree, { iac: 'cdk' });

      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
      });

      expectHasMetricTags(tree, NX_MIGRATION_GENERATOR_INFO.metric);
    });
  });

  describe('within another workspace', () => {
    let tree: Tree;
    const PROJECT = '@test/plugin';
    const MIGRATIONS_JSON = 'tools/plugin/migrations.json';
    const PLUGIN_PKG = 'tools/plugin/package.json';
    const dir = (file: string) =>
      `tools/plugin/src/migrations/rename-foo-target/${file}`;

    beforeEach(() => {
      tree = createTreeUsingTsSolutionSetup();
      updateJson(tree, 'package.json', (json) => ({
        ...json,
        name: '@myorg/monorepo',
        type: 'module',
      }));
      writeJson(tree, 'tools/plugin/tsconfig.json', {});
      addProjectConfiguration(tree, PROJECT, {
        root: 'tools/plugin',
        sourceRoot: 'tools/plugin/src',
      });
    });

    it('should throw when the project has no tsconfig', async () => {
      addProjectConfiguration(tree, '@test/no-tsconfig', {
        root: 'tools/no-tsconfig',
        sourceRoot: 'tools/no-tsconfig/src',
      });

      await expect(
        tsNxMigrationGenerator(tree, {
          project: '@test/no-tsconfig',
          name: 'rename-foo-target',
          description: 'Rename the foo target to bar',
        }),
      ).rejects.toThrow(
        'Selected plugin project @test/no-tsconfig is not a TypeScript project',
      );
    });

    it('should create migrations.json if it does not exist', async () => {
      expect(tree.exists(MIGRATIONS_JSON)).toBeFalsy();

      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        preferInstallDependencies: false,
      });

      expect(tree.exists(MIGRATIONS_JSON)).toBeTruthy();
      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['rename-foo-target']).toEqual({
        description: 'Rename the foo target to bar',
        implementation: './src/migrations/rename-foo-target/migration',
      });
    });

    it('should create package.json and wire the nx-migrations field if absent', async () => {
      expect(tree.exists(PLUGIN_PKG)).toBeFalsy();

      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        preferInstallDependencies: false,
      });

      expect(tree.exists(PLUGIN_PKG)).toBeTruthy();
      const pkg = JSON.parse(tree.read(PLUGIN_PKG, 'utf-8'));
      expect(pkg['nx-migrations']).toEqual({ migrations: './migrations.json' });
    });

    it('should add the nx-migrations field to an existing package.json', async () => {
      writeJson(tree, PLUGIN_PKG, { name: '@test/plugin', version: '1.0.0' });

      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        preferInstallDependencies: false,
      });

      const pkg = JSON.parse(tree.read(PLUGIN_PKG, 'utf-8'));
      expect(pkg.version).toBe('1.0.0');
      expect(pkg['nx-migrations']).toEqual({ migrations: './migrations.json' });
    });

    it('should not modify an existing nx-migrations field', async () => {
      writeJson(tree, PLUGIN_PKG, {
        name: '@test/plugin',
        'nx-migrations': { migrations: './custom-migrations.json' },
      });

      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        preferInstallDependencies: false,
      });

      const pkg = JSON.parse(tree.read(PLUGIN_PKG, 'utf-8'));
      expect(pkg['nx-migrations']).toEqual({
        migrations: './custom-migrations.json',
      });
    });

    it('should add @nx/devkit to a user workspace for implementation migrations', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        preferInstallDependencies: false,
      });

      const pkg = JSON.parse(tree.read(PLUGIN_PKG, 'utf-8'));
      expect(pkg.dependencies?.['@nx/devkit']).toBeDefined();
    });

    it('should not add @nx/devkit for an agentic (prompt-only) migration', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        kind: 'agentic',
        preferInstallDependencies: false,
      });

      const pkg = JSON.parse(tree.read(PLUGIN_PKG, 'utf-8'));
      expect(pkg.dependencies?.['@nx/devkit']).toBeUndefined();
    });

    it('should register the migration with project-relative paths', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        kind: 'hybrid',
        preferInstallDependencies: false,
      });

      expect(tree.exists(dir('migration.ts'))).toBeTruthy();
      expect(tree.exists(dir('prompt.md'))).toBeTruthy();
      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['rename-foo-target']).toEqual({
        description: 'Rename the foo target to bar',
        implementation: './src/migrations/rename-foo-target/migration',
        prompt: './src/migrations/rename-foo-target/prompt.md',
      });
    });

    it('should not allocate a metric outside the plugin repo', async () => {
      await tsNxMigrationGenerator(tree, {
        project: PROJECT,
        name: 'rename-foo-target',
        description: 'Rename the foo target to bar',
        preferInstallDependencies: false,
      });

      const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
      expect(migrations.generators['rename-foo-target'].metric).toBeUndefined();
    });
  });
});
