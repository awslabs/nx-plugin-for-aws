/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tree,
  readNxJson,
  addProjectConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
} from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { configureEslint } from './eslint';
import { ConfigureProjectOptions } from './types';

describe('eslint configuration', () => {
  let tree: Tree;
  const projectName = 'test-project';
  const options: ConfigureProjectOptions = {
    fullyQualifiedName: projectName,
    dir: `packages/${projectName}`,
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();

    // Create minimal nx.json
    tree.write(
      'nx.json',
      JSON.stringify({
        plugins: [],
      }),
    );

    // Create minimal package.json
    tree.write(
      'package.json',
      JSON.stringify({
        name: 'test-workspace',
        devDependencies: {},
      }),
    );

    // Add a project configuration so readProjectConfigurationUnqualified can find it
    addProjectConfiguration(tree, projectName, {
      root: `packages/${projectName}`,
      targets: {},
    });
  });

  describe('configureEslint', () => {
    it('should configure project with lint target', () => {
      configureEslint(tree, options);

      const projectConfig = readProjectConfiguration(tree, projectName);
      expect(projectConfig.targets?.lint).toBeDefined();
      expect(projectConfig.targets.lint).toEqual({
        executor: '@nx/eslint:lint',
      });
    });

    it('should not remove existing targets when adding lint', () => {
      // Add an existing target first
      updateProjectConfiguration(tree, projectName, {
        root: `packages/${projectName}`,
        targets: {
          build: {
            executor: '@nx/js:tsc',
          },
        },
      });

      configureEslint(tree, options);

      const projectConfig = readProjectConfiguration(tree, projectName);
      expect(projectConfig.targets?.lint).toEqual({
        executor: '@nx/eslint:lint',
      });
      expect(projectConfig.targets?.build).toEqual({
        executor: '@nx/js:tsc',
      });
    });

    it('should configure target defaults for lint in nx.json', () => {
      tree.write('eslint.config.mjs', `export default [];`);

      configureEslint(tree, options);

      const nxJson = readNxJson(tree);
      expect(nxJson.targetDefaults?.lint).toBeDefined();
      expect(nxJson.targetDefaults.lint.cache).toBe(true);
      expect(nxJson.targetDefaults.lint.configurations).toEqual({
        fix: {
          fix: true,
        },
        'skip-lint': {
          force: true,
        },
      });
      expect(nxJson.targetDefaults.lint.inputs).toEqual([
        'default',
        '{workspaceRoot}/eslint.config.mjs',
        '{projectRoot}/eslint.config.mjs',
      ]);
    });

    it('should skip eslint config when file does not exist', () => {
      configureEslint(tree, options);

      expect(tree.exists('eslint.config.mjs')).toBeFalsy();
    });
  });

  describe('eslint.config.mjs configuration', () => {
    beforeEach(() => {
      // Create basic eslint.config.mjs
      tree.write('eslint.config.mjs', `export default [];`);
    });

    it('should add prettier plugin import and configuration', () => {
      configureEslint(tree, options);

      const eslintConfig = tree.read('eslint.config.mjs', 'utf-8');
      expect(eslintConfig).toContain(
        'import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended"',
      );
      expect(eslintConfig).toContain('eslintPluginPrettierRecommended');
    });

    it('should not duplicate prettier plugin import', () => {
      // Add prettier plugin first time
      configureEslint(tree, options);
      const firstConfig = tree.read('eslint.config.mjs', 'utf-8');

      // Add prettier plugin second time
      configureEslint(tree, options);
      const secondConfig = tree.read('eslint.config.mjs', 'utf-8');

      // Count occurrences of the import
      const importMatches = secondConfig.match(
        /import eslintPluginPrettierRecommended from/g,
      );
      expect(importMatches).toHaveLength(1);
    });

    it('should create ignores object when none exists', () => {
      configureEslint(tree, options);

      const eslintConfig = tree.read('eslint.config.mjs', 'utf-8');
      expect(eslintConfig).toContain('ignores');
      expect(eslintConfig).toContain('**/vite.config.*.timestamp*');
    });

    it('should add to existing ignores array', () => {
      // Create eslint config with existing ignores
      tree.write(
        'eslint.config.mjs',
        `export default [
  {
    ignores: ["existing-pattern"]
  }
];`,
      );

      configureEslint(tree, options);

      const eslintConfig = tree.read('eslint.config.mjs', 'utf-8');
      expect(eslintConfig).toContain('existing-pattern');
      expect(eslintConfig).toContain('**/vite.config.*.timestamp*');
    });

    it('should not duplicate ignore patterns', () => {
      // Create eslint config with the same pattern already present
      tree.write(
        'eslint.config.mjs',
        `export default [
  {
    ignores: ["**/vite.config.*.timestamp*"]
  }
];`,
      );

      configureEslint(tree, options);

      const eslintConfig = tree.read('eslint.config.mjs', 'utf-8');
      // Count occurrences of the pattern
      const patternMatches = eslintConfig.match(
        /\*\*\/vite\.config\.\*\.timestamp\*/g,
      );
      expect(patternMatches).toHaveLength(1);
    });

    it('should preserve non-string elements in ignores array', () => {
      // Create eslint config with mixed content in ignores
      tree.write(
        'eslint.config.mjs',
        `export default [
  {
    ignores: ["existing-pattern", someVariable, 123]
  }
];`,
      );

      configureEslint(tree, options);

      const eslintConfig = tree.read('eslint.config.mjs', 'utf-8');
      expect(eslintConfig).toContain('existing-pattern');
      expect(eslintConfig).toContain('someVariable');
      expect(eslintConfig).toContain('123');
      expect(eslintConfig).toContain('**/vite.config.*.timestamp*');
    });

    it('should handle complex eslint config structure', () => {
      // Create more complex eslint config
      tree.write(
        'eslint.config.mjs',
        `import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-console": "warn"
    }
  },
  {
    ignores: ["dist/**", "build/**"]
  }
];`,
      );

      configureEslint(tree, options);

      const eslintConfig = tree.read('eslint.config.mjs', 'utf-8');
      expect(eslintConfig).toContain('eslintPluginPrettierRecommended');
      expect(eslintConfig).toContain('dist/**');
      expect(eslintConfig).toContain('build/**');
      expect(eslintConfig).toContain('**/vite.config.*.timestamp*');
      expect(eslintConfig).toContain('js.configs.recommended');
      expect(eslintConfig).toContain('"no-console": "warn"');
    });
  });

  describe('package.json dependencies', () => {
    it('should add required dev dependencies', () => {
      configureEslint(tree, options);

      const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(packageJson.devDependencies).toHaveProperty('prettier');
      expect(packageJson.devDependencies).toHaveProperty(
        'eslint-plugin-prettier',
      );
      expect(packageJson.devDependencies).toHaveProperty('jsonc-eslint-parser');
    });

    it('should not overwrite existing dependencies', () => {
      // Set up package.json with existing dependencies
      tree.write(
        'package.json',
        JSON.stringify({
          name: 'test-workspace',
          devDependencies: {
            prettier: '^2.0.0',
            'existing-dep': '^1.0.0',
          },
        }),
      );

      configureEslint(tree, options);

      const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(packageJson.devDependencies['existing-dep']).toBe('^1.0.0');
      expect(packageJson.devDependencies).toHaveProperty('prettier');
      expect(packageJson.devDependencies).toHaveProperty(
        'eslint-plugin-prettier',
      );
      expect(packageJson.devDependencies).toHaveProperty('jsonc-eslint-parser');
    });
  });
});
