/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import { tsWebsiteGenerator } from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';

describe('ts#website generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should delegate to tsReactWebsiteGenerator and produce a website', async () => {
    await tsWebsiteGenerator(tree, {
      name: 'my-website',
      iacProvider: 'CDK',
    });

    expect(tree.exists('my-website/src/main.tsx')).toBeTruthy();
    expect(tree.exists('my-website/src/config.ts')).toBeTruthy();
    expect(tree.exists('my-website/src/routes/__root.tsx')).toBeTruthy();
  });

  it('should set generator metadata to ts#react-website with framework field', async () => {
    await tsWebsiteGenerator(tree, {
      name: 'my-website',
      iacProvider: 'CDK',
    });

    const projectConfig = readJson(tree, 'my-website/project.json');
    expect(projectConfig.metadata).toHaveProperty(
      'generator',
      'ts#react-website',
    );
    expect(projectConfig.metadata).toHaveProperty('framework', 'react');
  });

  it('should default framework to react', async () => {
    await tsWebsiteGenerator(tree, {
      name: 'my-website',
      iacProvider: 'CDK',
    });

    const projectConfig = readJson(tree, 'my-website/project.json');
    expect(projectConfig.metadata.framework).toBe('react');
  });

  it('should pass framework=react explicitly', async () => {
    await tsWebsiteGenerator(tree, {
      name: 'my-website',
      framework: 'react',
      iacProvider: 'CDK',
    });

    const projectConfig = readJson(tree, 'my-website/project.json');
    expect(projectConfig.metadata.framework).toBe('react');
    expect(projectConfig.metadata.generator).toBe('ts#react-website');
  });

  it('should pass through uxProvider option', async () => {
    await tsWebsiteGenerator(tree, {
      name: 'my-website',
      framework: 'react',
      uxProvider: 'Shadcn',
      enableTailwind: true,
      iacProvider: 'CDK',
    });

    expect(tree.exists('my-website/src/main.tsx')).toBeTruthy();
  });
});
