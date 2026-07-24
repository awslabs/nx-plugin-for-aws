/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, writeJson } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { nxMigrationGenerator } from './generator';

const MIGRATIONS_JSON = 'packages/nx-plugin/migrations.json';

describe('nx-migration generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    writeJson(tree, MIGRATIONS_JSON, {
      $schema: 'http://json-schema.org/schema',
      name: '@aws/nx-plugin',
      generators: {},
    });
  });

  const dir = (file: string) =>
    `packages/nx-plugin/src/migrations/rename-foo-target/${file}`;

  it('should scaffold a deterministic migration and its test by default', async () => {
    await nxMigrationGenerator(tree, {
      name: 'rename-foo-target',
      description: 'Rename the foo target to bar',
    });

    expect(tree.exists(dir('migration.ts'))).toBeTruthy();
    expect(tree.exists(dir('migration.spec.ts'))).toBeTruthy();
    expect(tree.exists(dir('prompt.md'))).toBeFalsy();
  });

  it('should register a deterministic migration with implementation only, no version', async () => {
    await nxMigrationGenerator(tree, {
      name: 'rename-foo-target',
      description: 'Rename the foo target to bar',
    });

    const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
    expect(migrations.generators['rename-foo-target']).toEqual({
      description: 'Rename the foo target to bar',
      implementation: './src/migrations/rename-foo-target/migration',
    });
    expect(migrations.generators['rename-foo-target'].version).toBeUndefined();
  });

  it('should scaffold an agentic migration as a prompt only', async () => {
    await nxMigrationGenerator(tree, {
      name: 'rename-foo-target',
      description: 'Rename the foo target to bar',
      kind: 'agentic',
    });

    expect(tree.exists(dir('prompt.md'))).toBeTruthy();
    expect(tree.exists(dir('migration.ts'))).toBeFalsy();

    const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
    expect(migrations.generators['rename-foo-target']).toEqual({
      description: 'Rename the foo target to bar',
      prompt: './src/migrations/rename-foo-target/prompt.md',
    });
  });

  it('should scaffold a hybrid migration with both implementation and prompt', async () => {
    await nxMigrationGenerator(tree, {
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
    await nxMigrationGenerator(tree, {
      name: 'rename-foo-target',
      description: 'Rename the foo target to bar',
      kind: 'hybrid',
    });

    const migration = tree.read(dir('migration.ts'), 'utf-8');
    expect(migration).toContain('agentContext');
  });

  it('should kebab-case the migration name', async () => {
    await nxMigrationGenerator(tree, {
      name: 'Rename Foo Target',
      description: 'Rename the foo target to bar',
    });

    expect(
      tree.exists(
        'packages/nx-plugin/src/migrations/rename-foo-target/migration.ts',
      ),
    ).toBeTruthy();
    const migrations = JSON.parse(tree.read(MIGRATIONS_JSON, 'utf-8'));
    expect(migrations.generators['rename-foo-target']).toBeDefined();
  });

  it('should reference the migration description in the scaffolded file', async () => {
    await nxMigrationGenerator(tree, {
      name: 'rename-foo-target',
      description: 'Rename the foo target to bar',
    });

    const migration = tree.read(
      'packages/nx-plugin/src/migrations/rename-foo-target/migration.ts',
      'utf-8',
    );
    expect(migration).toContain('Rename the foo target to bar');
    expect(migration).toContain('MigrationReturnObject');
  });

  it('should not overwrite an existing migration implementation', async () => {
    const migrationPath =
      'packages/nx-plugin/src/migrations/rename-foo-target/migration.ts';
    tree.write(migrationPath, '// custom implementation');

    await nxMigrationGenerator(tree, {
      name: 'rename-foo-target',
      description: 'Rename the foo target to bar',
    });

    expect(tree.read(migrationPath, 'utf-8')).toContain(
      '// custom implementation',
    );
  });
});
