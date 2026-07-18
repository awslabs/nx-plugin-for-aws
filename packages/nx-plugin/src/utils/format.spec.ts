/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatFilesInSubtree, requiresPythonToRuffTarget } from './format';
import { createTreeUsingTsSolutionSetup } from './test';

describe('requiresPythonToRuffTarget', () => {
  it('maps a lower-bound specifier to a ruff target', () => {
    expect(requiresPythonToRuffTarget('>=3.14')).toBe('py314');
    expect(requiresPythonToRuffTarget('>=3.9')).toBe('py39');
  });
  it('uses the lowest version in a range', () => {
    expect(requiresPythonToRuffTarget('>=3.12,<3.15')).toBe('py312');
  });
  it('returns undefined for missing or unparseable input', () => {
    expect(requiresPythonToRuffTarget(undefined)).toBeUndefined();
    expect(requiresPythonToRuffTarget('')).toBeUndefined();
    expect(requiresPythonToRuffTarget(3.14 as unknown)).toBeUndefined();
  });
});

describe('format utils', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  /**
   * Register a Python project with the given module name, mirroring what the
   * py#project generator writes: an Nx project plus a pyproject.toml declaring
   * the importable module in [tool.hatch.build.targets.wheel].packages and an
   * optional [tool.ruff] line-length.
   */
  const addFirstPartyPythonProject = (
    name: string,
    moduleName: string,
    lineLength?: number,
    requiresPython?: string,
  ) => {
    const root = `packages/${name}`;
    addProjectConfiguration(tree, `proj.${name}`, { root });
    tree.write(
      `${root}/pyproject.toml`,
      [
        '[tool.hatch.build.targets.wheel]',
        `packages = [ "${moduleName}" ]`,
        '',
        ...(lineLength !== undefined
          ? ['[tool.ruff]', `line-length = ${lineLength}`, '']
          : []),
        '[project]',
        `name = "proj-${name}"`,
        ...(requiresPython !== undefined
          ? [`requires-python = "${requiresPython}"`]
          : []),
        '',
      ].join('\n'),
    );
    tree.write(`${root}/${moduleName}/__init__.py`, '');
  };
  describe('formatFilesInSubtree', () => {
    it('should format files in the given directory', async () => {
      // Setup
      const testFiles = {
        'src/test1.ts': 'const x=1;const y=2;const z=3;',
        'src/test2.ts': 'function test(){return true}',
        'other/test3.ts': 'const y=2;',
      };
      Object.entries(testFiles).forEach(([path, content]) => {
        tree.write(path, content);
      });
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - these should match biome's formatting with our default config
      expect(tree.read('src/test1.ts')?.toString()).toBe(
        'const x = 1;\nconst y = 2;\nconst z = 3;\n',
      );
      expect(tree.read('src/test2.ts')?.toString()).toBe(
        'function test() {\n  return true;\n}\n',
      );
      // Files outside src should remain unformatted
      expect(tree.read('other/test3.ts')?.toString()).toBe('const y=2;');
    });
    it('should use biome config from tree if available', async () => {
      // Setup - biome config with no semicolons
      tree.write(
        'biome.json',
        JSON.stringify({
          formatter: { indentStyle: 'space', indentWidth: 2 },
          javascript: {
            formatter: { quoteStyle: 'single', semicolons: 'asNeeded' },
          },
        }),
      );
      tree.write('src/test.ts', 'const x=1;const y="hello";');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - should respect biome config (no semicolons, single quotes)
      expect(tree.read('src/test.ts')?.toString()).toBe(
        "const x = 1\nconst y = 'hello'\n",
      );
    });
    it('should apply in-tree config changes without writing a config file', async () => {
      // Setup - in-memory config change made within this generator run (tabs)
      tree.write(
        'biome.json',
        JSON.stringify({
          formatter: { indentStyle: 'tab' },
          javascript: { formatter: { quoteStyle: 'double' } },
        }),
      );
      tree.write('src/test.ts', 'function f(){const x="hi";return x}');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - tab indentation and double quotes from the in-tree config
      expect(tree.read('src/test.ts')?.toString()).toBe(
        'function f() {\n\tconst x = "hi";\n\treturn x;\n}\n',
      );
    });
    it('should not format deleted files', async () => {
      // Setup
      tree.write('src/test.ts', 'const x=1;');
      tree.delete('src/test.ts');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify
      expect(tree.exists('src/test.ts')).toBe(false);
    });
    it('should format all changed files when no directory is given', async () => {
      // Setup
      tree.write('src/test.ts', 'const x=1;');
      tree.write('lib/test.ts', 'const y=2;');
      // Execute
      await formatFilesInSubtree(tree);
      // Verify - both files are formatted
      expect(tree.read('src/test.ts')?.toString()).toBe('const x = 1;\n');
      expect(tree.read('lib/test.ts')?.toString()).toBe('const y = 2;\n');
    });
    it('should sort imports in Python files', async () => {
      // isort (ruff rule I) is not in ruff's default rule set and the project
      // config is not on disk during generation, so the formatter must opt into
      // import sorting explicitly to match what the project's build enforces.
      tree.write(
        'src/__init__.py',
        [
          'from .b import beta',
          'from .a import alpha',
          '',
          '__all__ = ["beta", "alpha"]',
          '',
        ].join('\n'),
      );
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - imports sorted alphabetically
      expect(tree.read('src/__init__.py')?.toString()).toBe(
        [
          'from .a import alpha',
          'from .b import beta',
          '',
          '__all__ = ["beta", "alpha"]',
          '',
        ].join('\n'),
      );
    });
    it('should group a workspace package as first-party even when its module is not on disk', async () => {
      // During generation the project's module lives only in the tree, so ruff
      // cannot detect it as first-party from the filesystem. The formatter reads
      // the project's module name from its pyproject.toml and passes
      // known-first-party so the project's own imports sort into their own
      // group, matching what the on-disk build enforces (I001).
      addFirstPartyPythonProject('my_lib', 'my_lib');
      tree.write(
        'packages/my_lib/my_lib/main.py',
        [
          'import os',
          'import boto3',
          'from my_lib.core import helper',
          '',
          'x = os, boto3, helper',
          '',
        ].join('\n'),
      );
      // Execute
      await formatFilesInSubtree(tree, 'packages/my_lib');
      // Verify - stdlib, third-party and first-party each in their own group
      expect(tree.read('packages/my_lib/my_lib/main.py')?.toString()).toBe(
        [
          'import os',
          '',
          'import boto3',
          '',
          'from my_lib.core import helper',
          '',
          'x = os, boto3, helper',
          '',
        ].join('\n'),
      );
    });
    it('should treat a sibling workspace project as third-party, matching the on-disk build', async () => {
      // On disk ruff runs per-project, so a sibling workspace package is
      // third-party to the importing project (only the owning project's module
      // is first-party). Scoping known-first-party to the owning project keeps
      // in-tree formatting consistent with the build (which would otherwise
      // fail with I001 on a spurious blank line).
      addFirstPartyPythonProject('other_lib', 'other_lib');
      addFirstPartyPythonProject('my_lib', 'my_lib');
      tree.write(
        'packages/my_lib/my_lib/main.py',
        [
          'import boto3',
          'from my_lib.core import helper',
          'from other_lib import thing',
          '',
          'x = boto3, helper, thing',
          '',
        ].join('\n'),
      );
      // Execute
      await formatFilesInSubtree(tree, 'packages/my_lib');
      // Verify - boto3 and the sibling other_lib share the third-party group;
      // only my_lib (the owning project) is its own first-party group.
      expect(tree.read('packages/my_lib/my_lib/main.py')?.toString()).toBe(
        [
          'import boto3',
          'from other_lib import thing',
          '',
          'from my_lib.core import helper',
          '',
          'x = boto3, helper, thing',
          '',
        ].join('\n'),
      );
    });
    it('should not treat installed packages under .venv or node_modules as first-party', async () => {
      // Installed third-party packages are not Nx projects, so enumerating
      // first-party modules via the project graph never picks them up — no
      // ignore list required.
      tree.write('.venv/lib/boto3/__init__.py', '');
      tree.write('node_modules/some_pkg/__init__.py', '');
      addFirstPartyPythonProject('my_lib', 'my_lib');
      tree.write(
        'packages/my_lib/my_lib/main.py',
        [
          'import boto3',
          'from my_lib.core import helper',
          '',
          'x = boto3, helper',
          '',
        ].join('\n'),
      );
      // Execute
      await formatFilesInSubtree(tree, 'packages/my_lib');
      // Verify - boto3 stays third-party (own group), my_lib first-party
      expect(tree.read('packages/my_lib/my_lib/main.py')?.toString()).toBe(
        [
          'import boto3',
          '',
          'from my_lib.core import helper',
          '',
          'x = boto3, helper',
          '',
        ].join('\n'),
      );
    });
    it("should apply the owning project's line-length when its config is not on disk", async () => {
      // The project's [tool.ruff] line-length lives only in the tree during
      // generation, so ruff would otherwise wrap at its default of 88 and
      // produce output the on-disk build (line-length 120) reformats.
      addFirstPartyPythonProject('my_lib', 'my_lib', 120);
      const line =
        'def compute(first_value, second_value, third_value, fourth_value, fifth_value, sixth_val):';
      tree.write(
        'packages/my_lib/my_lib/main.py',
        [line, '    return first_value', ''].join('\n'),
      );
      // Execute
      await formatFilesInSubtree(tree, 'packages/my_lib');
      // Verify - the 90-char signature stays on one line at line-length 120
      expect(tree.read('packages/my_lib/my_lib/main.py')?.toString()).toBe(
        [line, '    return first_value', ''].join('\n'),
      );
    });
    it("should apply the owning project's target-version so output matches the on-disk build", async () => {
      // For py314+ ruff drops the parentheses from a multi-exception `except`
      addFirstPartyPythonProject('my_lib', 'my_lib', undefined, '>=3.14');
      tree.write(
        'packages/my_lib/my_lib/main.py',
        [
          'def f():',
          '    try:',
          '        pass',
          '    except (ValueError, KeyError):',
          '        pass',
          '',
        ].join('\n'),
      );
      // Execute
      await formatFilesInSubtree(tree, 'packages/my_lib');
      // Verify - py314 formatting removes the parentheses
      expect(tree.read('packages/my_lib/my_lib/main.py')?.toString()).toContain(
        'except ValueError, KeyError:',
      );
    });
    it('should format json and css files', async () => {
      // Setup
      tree.write('src/data.json', '{"a":1,"b":2}');
      tree.write('src/styles.css', '.a{color:red}');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify
      expect(tree.read('src/data.json')?.toString()).toBe(
        '{ "a": 1, "b": 2 }\n',
      );
      expect(tree.read('src/styles.css')?.toString()).toBe(
        '.a {\n  color: red;\n}\n',
      );
    });
  });

  describe('formatFilesInSubtree with an on-disk biome.json', () => {
    let workspaceDir: string;
    beforeEach(() => {
      // Point the tree at a real directory so the on-disk biome.json is used.
      workspaceDir = mkdtempSync(path.join(tmpdir(), 'nx-plugin-format-'));
      tree.root = workspaceDir;
    });
    afterEach(() => {
      rmSync(workspaceDir, { recursive: true, force: true });
    });
    it("should format using the workspace's on-disk biome config", async () => {
      // Setup - on-disk config with no semicolons and single quotes
      writeFileSync(
        path.join(workspaceDir, 'biome.json'),
        JSON.stringify({
          $schema: 'https://biomejs.dev/schemas/2.4.16/schema.json',
          root: true,
          formatter: { indentStyle: 'space', indentWidth: 2 },
          javascript: {
            formatter: { quoteStyle: 'single', semicolons: 'asNeeded' },
          },
        }),
      );
      tree.write('src/test.ts', 'const x=1;const y="hello";');
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - respects the on-disk config (no semicolons, single quotes)
      expect(tree.read('src/test.ts')?.toString()).toBe(
        "const x = 1\nconst y = 'hello'\n",
      );
    });
    it('should defer to an on-disk ruff config that omits import sorting', async () => {
      // On-disk ruff config selecting rules that exclude isort (I): the
      // formatter must honour it and leave imports unsorted rather than forcing
      // import sorting on.
      writeFileSync(
        path.join(workspaceDir, 'ruff.toml'),
        ['[lint]', 'select = ["E", "F"]', ''].join('\n'),
      );
      const unsorted = [
        'from .b import beta',
        'from .a import alpha',
        '',
        '__all__ = ["beta", "alpha"]',
        '',
      ].join('\n');
      tree.write('src/__init__.py', unsorted);
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - imports left as-is (the on-disk config does not enable I)
      expect(tree.read('src/__init__.py')?.toString()).toBe(unsorted);
    });
    it('should ignore a ruff config above the workspace root', async () => {
      // A ruff config in a parent of the workspace (e.g. a stray config on the
      // host) must not be treated as the project's: config discovery stops at
      // tree.root, so import sorting is still applied.
      const nestedRoot = path.join(workspaceDir, 'nested-workspace');
      mkdirSync(nestedRoot);
      tree.root = nestedRoot;
      writeFileSync(
        path.join(workspaceDir, 'ruff.toml'),
        ['[lint]', 'select = ["E", "F"]', ''].join('\n'),
      );
      tree.write(
        'src/__init__.py',
        ['from .b import beta', 'from .a import alpha', ''].join('\n'),
      );
      // Execute
      await formatFilesInSubtree(tree, 'src');
      // Verify - the out-of-workspace config is ignored, so imports are sorted
      expect(tree.read('src/__init__.py')?.toString()).toBe(
        ['from .a import alpha', 'from .b import beta', ''].join('\n'),
      );
    });
  });
});
