/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getProjects, type Tree } from '@nx/devkit';
import { flushChanges } from 'nx/src/generators/tree';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { greengrassComponentGenerator } from '../greengrass/component/generator.js';
import { tsInfraGenerator } from '../infra/app/generator.js';
import { tsProjectGenerator } from '../ts/lib/generator.js';
import { tsNxGeneratorGenerator } from '../ts/nx-generator/generator.js';
import { tsNxPluginGenerator } from '../ts/nx-plugin/generator.js';
import { tsReactWebsiteGenerator } from '../ts/react-website/app/generator.js';
import { createTreeUsingTsSolutionSetup } from './test.js';

/** The Biome CLI the repo installs, which matches the version vended. */
const BIOME_BIN = createRequire(import.meta.url).resolve(
  '@biomejs/biome/bin/biome',
);

const TIMEOUT = 300_000;

const runBiome = (cwd: string, args: string[]) => {
  const result = spawnSync(
    process.execPath,
    [BIOME_BIN, ...args, '--max-diagnostics=none'],
    { cwd, encoding: 'utf-8' },
  );
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
};

const listFiles = (dir: string, root: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = path.posix.join(dir, entry.name);
      return entry.isDirectory()
        ? listFiles(relative, root)
        : entry.isFile()
          ? [relative]
          : [];
    },
  );

/**
 * Runs the real Biome CLI with the vended biome.json over a generated workspace,
 * including the Markdown and YAML files that the in-process formatter skips.
 */
describe('vended biome.json with the Biome CLI', () => {
  let tree: Tree;
  let dir: string;
  let projectRoots: string[];

  beforeAll(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsProjectGenerator(tree, {
      name: 'lib',
      preferInstallDependencies: false,
    });
    await greengrassComponentGenerator(tree, {
      project: '@proj/lib',
      name: 'pulse',
      language: 'typescript',
      infra: 'none',
    });
    await tsReactWebsiteGenerator(tree, { name: 'website', iac: 'cdk' });
    await tsInfraGenerator(tree, { name: 'infra' });
    await tsNxPluginGenerator(tree, { name: 'plugin' });
    const pluginProject = [...getProjects(tree).entries()].find(
      ([, config]) => config.root === 'plugin',
    )?.[0];
    if (!pluginProject) {
      throw new Error('ts#nx-plugin project not found');
    }
    await tsNxGeneratorGenerator(tree, {
      project: pluginProject,
      name: 'foo#bar',
    });

    dir = mkdtempSync(path.join(tmpdir(), 'vended-biome-'));
    flushChanges(dir, tree.listChanges());
    projectRoots = [...getProjects(tree).values()].map(
      (project) => project.root,
    );
  }, TIMEOUT);

  afterAll(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    'should pass the format target on every generated project',
    () => {
      // The vended `format` target runs `biome format {projectRoot}`.
      const { status, output } = runBiome(dir, ['format', ...projectRoots]);
      expect(status, output).toBe(0);
    },
    TIMEOUT,
  );

  /**
   * Biome 2.6 lints Markdown and YAML files, but its rules for them are all in
   * the nursery group, which the vended `preset: 'none'` does not enable. This
   * guards against a later Biome default that reports on generated files.
   */
  it(
    'should pass lint on generated Markdown and YAML',
    () => {
      const files = projectRoots
        .flatMap((root) => listFiles(root, dir))
        .filter((file) => /\.(md|ya?ml)$/.test(file));
      expect(files.some((file) => file.endsWith('README.md'))).toBe(true);
      expect(files).toContain('lib/greengrass/pulse/recipe.yaml');

      const { status, output } = runBiome(dir, ['lint', ...files]);
      expect(status, output).toBe(0);
    },
    TIMEOUT,
  );
});
