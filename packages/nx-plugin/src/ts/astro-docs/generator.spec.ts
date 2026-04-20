/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import {
  tsAstroDocsGenerator,
  TS_ASTRO_DOCS_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';

describe('ts#astro-docs generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a docs site with default options (translation + blog enabled)', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'docs',
      skipInstall: true,
    });

    // Default directory is '.' and default subDirectory is kebab-case of the name
    expect(tree.exists('docs/project.json')).toBeTruthy();
    expect(tree.exists('docs/astro.config.mjs')).toBeTruthy();
    expect(tree.exists('docs/tsconfig.json')).toBeTruthy();
    expect(tree.exists('docs/src/components/link.astro')).toBeTruthy();
    expect(tree.exists('docs/src/components/snippet.astro')).toBeTruthy();
    expect(tree.exists('docs/src/content/docs/en/index.mdx')).toBeTruthy();
    expect(
      tree.exists('docs/src/content/docs/en/guides/getting-started.mdx'),
    ).toBeTruthy();
    // Blog is on by default.
    expect(
      tree.exists('docs/src/content/docs/en/blog/welcome.mdx'),
    ).toBeTruthy();
    expect(
      tree.exists('docs/src/content/docs/en/snippets/example.mdx'),
    ).toBeTruthy();
    expect(tree.exists('docs/src/styles/custom.css')).toBeTruthy();

    // Translation files ARE present by default (opt-out).
    expect(tree.exists('docs/scripts/translate.ts')).toBeTruthy();
    expect(tree.exists('docs/scripts/translate.config.json')).toBeTruthy();

    const projectConfig = readJson(tree, 'docs/project.json');
    expect(projectConfig.name).toBe('@proj/docs');
    expect(projectConfig.sourceRoot).toBe('docs/src');
    expect(projectConfig.projectType).toBe('application');
    expect(projectConfig.targets.build).toBeDefined();
    expect(projectConfig.targets.start).toBeDefined();
    expect(projectConfig.targets.serve).toEqual({ dependsOn: ['start'] });
    expect(projectConfig.targets.preview).toBeDefined();
    expect(projectConfig.targets.translate).toBeDefined();

    expect(tree.read('docs/astro.config.mjs', 'utf-8')).toMatchSnapshot(
      'astro.config.mjs',
    );
    expect(tree.read('docs/tsconfig.json', 'utf-8')).toMatchSnapshot(
      'tsconfig.json',
    );
    expect(tree.read('docs/project.json', 'utf-8')).toMatchSnapshot(
      'project.json',
    );
    expect(
      tree.read('docs/src/components/link.astro', 'utf-8'),
    ).toMatchSnapshot('link.astro');
    expect(
      tree.read('docs/src/components/snippet.astro', 'utf-8'),
    ).toMatchSnapshot('snippet.astro');
    expect(
      tree.read('docs/src/content/docs/en/index.mdx', 'utf-8'),
    ).toMatchSnapshot('index.mdx');
    expect(
      tree.read('docs/scripts/translate.config.json', 'utf-8'),
    ).toMatchSnapshot('translate.config.json');
  });

  it('should add astro + starlight + translation dependencies to the root package.json', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'docs',
      skipInstall: true,
    });

    const packageJson = readJson(tree, 'package.json');
    const deps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    expect(deps).toHaveProperty('astro');
    expect(deps).toHaveProperty('@astrojs/starlight');
    // Blog on by default.
    expect(deps).toHaveProperty('starlight-blog');
    // Translation on by default.
    expect(deps).toHaveProperty('@strands-agents/sdk');
    expect(deps).toHaveProperty('commander');
    expect(deps).toHaveProperty('tsx');
  });

  it('should use the project name as the site title', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'my-cool-docs',
      skipInstall: true,
    });

    const astroConfig = tree.read('my-cool-docs/astro.config.mjs', 'utf-8');
    expect(astroConfig).toContain("title: 'my-cool-docs'");
  });

  it('should default subDirectory to the kebab-case project name', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'MyDocsSite',
      skipInstall: true,
    });

    // Should land at my-docs-site/ (kebab-cased)
    expect(tree.exists('my-docs-site/project.json')).toBeTruthy();
    expect(tree.exists('my-docs-site/astro.config.mjs')).toBeTruthy();
  });

  it('should omit translation files and target when --noTranslation is passed', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'docs',
      noTranslation: true,
      skipInstall: true,
    });

    expect(tree.exists('docs/scripts/translate.ts')).toBeFalsy();
    expect(tree.exists('docs/scripts/translate.config.json')).toBeFalsy();

    const projectConfig = readJson(tree, 'docs/project.json');
    expect(projectConfig.targets.translate).toBeUndefined();

    const packageJson = readJson(tree, 'package.json');
    const deps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    expect(deps).not.toHaveProperty('@strands-agents/sdk');
    expect(deps).not.toHaveProperty('commander');
  });

  it('should omit the blog when --noBlog is passed', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'docs',
      noBlog: true,
      skipInstall: true,
    });

    expect(
      tree.exists('docs/src/content/docs/en/blog/welcome.mdx'),
    ).toBeFalsy();

    const astroConfig = tree.read('docs/astro.config.mjs', 'utf-8');
    expect(astroConfig).not.toContain('starlight-blog');
    expect(astroConfig).not.toContain('starlightBlog(');

    const packageJson = readJson(tree, 'package.json');
    const deps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };
    expect(deps).not.toHaveProperty('starlight-blog');
  });

  it('should respect custom directory and subDirectory', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'my-docs',
      directory: 'sites',
      subDirectory: 'docs-site',
      skipInstall: true,
    });

    expect(tree.exists('sites/docs-site/project.json')).toBeTruthy();
    expect(tree.exists('sites/docs-site/astro.config.mjs')).toBeTruthy();

    const projectConfig = readJson(tree, 'sites/docs-site/project.json');
    expect(projectConfig.sourceRoot).toBe('sites/docs-site/src');
    expect(projectConfig.targets.build.options.cwd).toBe('sites/docs-site');
  });

  it('should add generator metadata to the project configuration', async () => {
    await tsAstroDocsGenerator(tree, {
      name: 'docs',
      skipInstall: true,
    });

    const projectConfig = readJson(tree, 'docs/project.json');
    expect(projectConfig.metadata).toHaveProperty(
      'generator',
      TS_ASTRO_DOCS_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata).toHaveProperty('includeTranslation', true);
    expect(projectConfig.metadata).toHaveProperty('includeBlog', true);
  });

  it('should add generator metric to app.ts when shared constructs exist', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await tsAstroDocsGenerator(tree, {
      name: 'docs',
      skipInstall: true,
    });

    expectHasMetricTags(tree, TS_ASTRO_DOCS_GENERATOR_INFO.metric);
  });
});
