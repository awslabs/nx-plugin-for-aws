/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  importMigration,
  MIGRATIONS_DIR,
  migrationDir,
} from './test-migration.js';

describe('test-migration', () => {
  describe('importMigration', () => {
    it('should load the migration function by name', async () => {
      const migration = await importMigration('add-deploy-sandbox-target');
      expect(migration).toBeTypeOf('function');
    });
  });

  describe('migrationDir', () => {
    it('should resolve a migration folder still in latest', () => {
      // `latest/` always holds the most recent unreleased migration, whatever
      // it is; assert the shape rather than a name that moves on release.
      const dir = migrationDir('sandbox-pattern-nested-stacks');
      expect(dir).toMatch(
        /src\/migrations\/(latest|v[^/]+)\/(\d{4}-)?sandbox-pattern-nested-stacks$/,
      );
      expect(existsSync(join(dir, 'migration.ts'))).toBe(true);
    });

    it('should resolve a released migration by name, ignoring its order prefix', () => {
      const dir = migrationDir('add-deploy-sandbox-target');
      expect(dir).toBe(
        join(MIGRATIONS_DIR, 'v1.0.0-rc.63', '0001-add-deploy-sandbox-target'),
      );
    });

    it('should throw when no migration has that name', () => {
      expect(() => migrationDir('no-such-migration')).toThrow(
        /no-such-migration/,
      );
    });
  });
});
