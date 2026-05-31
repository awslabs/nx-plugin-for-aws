/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import { tsDocsGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';

describe('ts#docs generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should delegate to tsAstroDocsGenerator and produce a docs site', async () => {
    await tsDocsGenerator(tree, {
      name: 'docs',
      skipInstall: true,
    });

    expect(tree.exists('docs/project.json')).toBeTruthy();
    expect(tree.exists('docs/astro.config.mjs')).toBeTruthy();
    expect(tree.exists('docs/tsconfig.json')).toBeTruthy();
    expect(tree.exists('docs/src/content/docs/en/index.mdx')).toBeTruthy();
  });

  it('should set generator metadata to ts#docs with framework field', async () => {
    await tsDocsGenerator(tree, {
      name: 'docs',
      skipInstall: true,
    });

    const projectConfig = readJson(tree, 'docs/project.json');
    expect(projectConfig.metadata).toHaveProperty('generator', 'ts#astro-docs');
    expect(projectConfig.metadata).toHaveProperty('framework', 'astro');
  });

  it('should default framework to astro', async () => {
    await tsDocsGenerator(tree, {
      name: 'docs',
      skipInstall: true,
    });

    const projectConfig = readJson(tree, 'docs/project.json');
    expect(projectConfig.metadata.framework).toBe('astro');
  });

  it('should pass framework=astro explicitly', async () => {
    await tsDocsGenerator(tree, {
      name: 'docs',
      framework: 'astro',
      skipInstall: true,
    });

    const projectConfig = readJson(tree, 'docs/project.json');
    expect(projectConfig.metadata.framework).toBe('astro');
    expect(projectConfig.metadata.generator).toBe('ts#astro-docs');
  });

  it('should pass through noTranslation option', async () => {
    await tsDocsGenerator(tree, {
      name: 'docs',
      noTranslation: true,
      skipInstall: true,
    });

    expect(tree.exists('docs/scripts/translate.ts')).toBeFalsy();
    const projectConfig = readJson(tree, 'docs/project.json');
    expect(projectConfig.targets.translate).toBeUndefined();
  });

  it('should pass through noBlog option', async () => {
    await tsDocsGenerator(tree, {
      name: 'docs',
      noBlog: true,
      skipInstall: true,
    });

    expect(
      tree.exists('docs/src/content/docs/en/blog/welcome.mdx'),
    ).toBeFalsy();
  });

  it('should respect custom directory and subDirectory', async () => {
    await tsDocsGenerator(tree, {
      name: 'my-docs',
      directory: 'sites',
      subDirectory: 'docs-site',
      skipInstall: true,
    });

    expect(tree.exists('sites/docs-site/project.json')).toBeTruthy();
    expect(tree.exists('sites/docs-site/astro.config.mjs')).toBeTruthy();
  });
});
