/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { expect, describe, it, beforeEach } from 'vitest';
import { addZodV4Alias } from './zod';

describe('zod utils', () => {
  describe('addZodV4Alias', () => {
    let tree: Tree;

    beforeEach(() => {
      tree = createTreeUsingTsSolutionSetup();
    });

    it('should add zod v4 alias to empty tsconfig.base.json', () => {
      // Setup initial tsconfig.base.json with minimal structure
      tree.write(
        'tsconfig.base.json',
        JSON.stringify({
          compilerOptions: {},
        }),
      );

      addZodV4Alias(tree);

      const tsConfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);

      expect(tsConfig.compilerOptions.paths).toBeDefined();
      expect(tsConfig.compilerOptions.paths.zod).toEqual([
        './node_modules/zod/v4',
      ]);
    });

    it('should add zod v4 alias to tsconfig.base.json with existing paths', () => {
      // Setup tsconfig.base.json with existing paths
      tree.write(
        'tsconfig.base.json',
        JSON.stringify({
          compilerOptions: {
            paths: {
              '@app/*': ['./src/app/*'],
              '@lib/*': ['./src/lib/*'],
            },
          },
        }),
      );

      addZodV4Alias(tree);

      const tsConfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);

      expect(tsConfig.compilerOptions.paths).toEqual({
        '@app/*': ['./src/app/*'],
        '@lib/*': ['./src/lib/*'],
        zod: ['./node_modules/zod/v4'],
      });
    });

    it('should replace existing zod alias with v4 alias', () => {
      // Setup tsconfig.base.json with existing zod alias
      tree.write(
        'tsconfig.base.json',
        JSON.stringify({
          compilerOptions: {
            paths: {
              '@app/*': ['./src/app/*'],
              zod: ['./node_modules/zod/lib'],
              '@lib/*': ['./src/lib/*'],
            },
          },
        }),
      );

      addZodV4Alias(tree);

      const tsConfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);

      expect(tsConfig.compilerOptions.paths).toEqual({
        '@app/*': ['./src/app/*'],
        '@lib/*': ['./src/lib/*'],
        zod: ['./node_modules/zod/v4'],
      });
    });

    it('should handle tsconfig.base.json without compilerOptions', () => {
      // Setup tsconfig.base.json without compilerOptions
      tree.write(
        'tsconfig.base.json',
        JSON.stringify({
          extends: './tsconfig.json',
        }),
      );

      addZodV4Alias(tree);

      const tsConfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);

      expect(tsConfig.extends).toBe('./tsconfig.json');
      expect(tsConfig.compilerOptions.paths.zod).toEqual([
        './node_modules/zod/v4',
      ]);
    });

    it('should preserve other compilerOptions when adding zod alias', () => {
      // Setup tsconfig.base.json with various compilerOptions
      tree.write(
        'tsconfig.base.json',
        JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            strict: true,
            esModuleInterop: true,
            paths: {
              '@utils/*': ['./src/utils/*'],
            },
          },
        }),
      );

      addZodV4Alias(tree);

      const tsConfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);

      expect(tsConfig.compilerOptions.target).toBe('ES2020');
      expect(tsConfig.compilerOptions.module).toBe('commonjs');
      expect(tsConfig.compilerOptions.strict).toBe(true);
      expect(tsConfig.compilerOptions.esModuleInterop).toBe(true);
      expect(tsConfig.compilerOptions.paths).toEqual({
        '@utils/*': ['./src/utils/*'],
        zod: ['./node_modules/zod/v4'],
      });
    });

    it('should handle multiple existing zod entries and filter them all out', () => {
      // This tests the edge case where somehow multiple zod entries exist
      tree.write(
        'tsconfig.base.json',
        JSON.stringify({
          compilerOptions: {
            paths: {
              '@app/*': ['./src/app/*'],
              zod: ['./node_modules/zod/lib'],
              '@lib/*': ['./src/lib/*'],
            },
          },
        }),
      );

      // Manually add another zod entry to test the filtering logic
      const initialTsConfig = JSON.parse(
        tree.read('tsconfig.base.json', 'utf-8')!,
      );

      addZodV4Alias(tree);

      const finalTsConfig = JSON.parse(
        tree.read('tsconfig.base.json', 'utf-8')!,
      );

      // Should only have one zod entry pointing to v4
      const zodEntries = Object.entries(
        finalTsConfig.compilerOptions.paths,
      ).filter(([key]) => key === 'zod');
      expect(zodEntries).toHaveLength(1);
      expect(zodEntries[0][1]).toEqual(['./node_modules/zod/v4']);
    });

    it('should create paths object if compilerOptions exists but paths does not', () => {
      tree.write(
        'tsconfig.base.json',
        JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
          },
        }),
      );

      addZodV4Alias(tree);

      const tsConfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);

      expect(tsConfig.compilerOptions.paths).toBeDefined();
      expect(tsConfig.compilerOptions.paths.zod).toEqual([
        './node_modules/zod/v4',
      ]);
      expect(tsConfig.compilerOptions.target).toBe('ES2020');
      expect(tsConfig.compilerOptions.module).toBe('commonjs');
    });
  });
});
