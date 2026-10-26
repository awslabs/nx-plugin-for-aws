/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';
import {
  formatFilesInSubtree,
  getDefaultBiomeConfig,
} from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const FORMATTER_OFF = { formatter: { enabled: false } };

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

/** Writes `biome.json` as given, in the 2-space layout Nx writes JSON with. */
const writeBiome = (tree: Tree, biome: object) =>
  tree.write('biome.json', JSON.stringify(biome, null, 2));

/** The `biome.json` vended before Biome 2.6: the current one without the keys. */
const givenOldBiomeConfig = (tree: Tree) => {
  const {
    markdown: _markdown,
    yaml: _yaml,
    ...biome
  } = getDefaultBiomeConfig(tree);
  writeBiome(tree, biome);
};

describe('biome-markdown-yaml-formatter-off migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should turn off Markdown and YAML formatting', async () => {
    givenOldBiomeConfig(tree);

    const result = await migration(tree);

    const biome = readJson(tree, 'biome.json');
    expect(biome.markdown).toEqual(FORMATTER_OFF);
    expect(biome.yaml).toEqual(FORMATTER_OFF);
    expect(result.nextSteps).toEqual([]);
  });

  it('should converge on the biome.json the generators write today', async () => {
    givenOldBiomeConfig(tree);

    await migration(tree);

    const expected = createTreeUsingTsSolutionSetup();
    await formatFilesInSubtree(expected);
    expect(read(tree, 'biome.json')).toBe(read(expected, 'biome.json'));
  });

  it('should leave a freshly vended biome.json unchanged', async () => {
    await formatFilesInSubtree(tree);
    const before = read(tree, 'biome.json');

    const result = await migration(tree);

    expect(read(tree, 'biome.json')).toBe(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    givenOldBiomeConfig(tree);
    await migration(tree);
    const once = read(tree, 'biome.json');

    const result = await migration(tree);

    expect(read(tree, 'biome.json')).toBe(once);
    expect(result.nextSteps).toEqual([]);
  });

  it("should keep the user's own Markdown formatter setting", async () => {
    const {
      markdown: _markdown,
      yaml: _yaml,
      ...biome
    } = getDefaultBiomeConfig(tree);
    writeBiome(tree, { ...biome, markdown: { formatter: { enabled: true } } });

    const result = await migration(tree);

    const migrated = readJson(tree, 'biome.json');
    expect(migrated.markdown).toEqual({ formatter: { enabled: true } });
    expect(migrated.yaml).toEqual(FORMATTER_OFF);
    expect(result.nextSteps).toEqual([]);
  });

  it("should keep the user's own YAML section", async () => {
    const {
      markdown: _markdown,
      yaml: _yaml,
      ...biome
    } = getDefaultBiomeConfig(tree);
    writeBiome(tree, { ...biome, yaml: { formatter: { indentWidth: 4 } } });

    const result = await migration(tree);

    const migrated = readJson(tree, 'biome.json');
    expect(migrated.yaml).toEqual({ formatter: { indentWidth: 4 } });
    expect(migrated.markdown).toEqual(FORMATTER_OFF);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a workspace without a biome config alone', async () => {
    tree.delete('biome.json');

    const result = await migration(tree);

    expect(tree.exists('biome.json')).toBe(false);
    expect(result.nextSteps).toEqual([]);
  });

  it('should append the keys to a biome.json without a css section', async () => {
    writeBiome(tree, { root: true });

    const result = await migration(tree);

    const migrated = readJson(tree, 'biome.json');
    expect(Object.keys(migrated)).toEqual(['root', 'markdown', 'yaml']);
    expect(migrated.root).toBe(true);
    expect(migrated.markdown).toEqual(FORMATTER_OFF);
    expect(migrated.yaml).toEqual(FORMATTER_OFF);
    expect(result.nextSteps).toEqual([]);
  });
});
