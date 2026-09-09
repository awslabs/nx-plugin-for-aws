/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import { getDefaultBiomeConfig } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const BUNDLE_GLOB = '**/rolldown.config.*.*js';

/** A `rolldown.config.ts` as the bundle target's generator writes it. */
const ROLLDOWN_CONFIG = `import { defineConfig } from 'rolldown';

export default defineConfig([]);
`;

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

const lines = (tree: Tree, path: string): string[] =>
  read(tree, path).split('\n');

/** Register a project, optionally with the rolldown config a bundle target adds. */
const givenProject = (
  tree: Tree,
  name: string,
  { withRolldownConfig = true } = {},
): string => {
  const root = `packages/${name}`;
  addProjectConfiguration(tree, `@proj/${name}`, {
    root,
    sourceRoot: `${root}/src`,
  });
  if (withRolldownConfig) {
    tree.write(`${root}/rolldown.config.ts`, ROLLDOWN_CONFIG);
  }
  return root;
};

describe('rolldown-config-bundle-transient migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // The `biome.json` an older release vended, without the exclude. Derived from
    // the current config by dropping it, so the anchor the migration keys off
    // stays in the shape the rest of the list has.
    const biome = getDefaultBiomeConfig(tree);
    tree.write(
      'biome.json',
      JSON.stringify(
        {
          ...biome,
          files: {
            ...biome.files,
            includes: biome.files.includes.filter(
              (include) => include !== `!${BUNDLE_GLOB}`,
            ),
          },
        },
        null,
        2,
      ),
    );
  });

  it('should exclude the transient config bundle from biome', async () => {
    givenProject(tree, 'lib');

    const result = await migration(tree);

    const includes = readJson(tree, 'biome.json').files.includes;
    expect(includes).toContain(`!${BUNDLE_GLOB}`);
    // Kept alongside the other build-output excludes.
    expect(includes.indexOf(`!${BUNDLE_GLOB}`)).toBe(
      includes.indexOf('!**/out-tsc') + 1,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should ignore the transient config bundle in a bundled project', async () => {
    const root = givenProject(tree, 'lib');

    await migration(tree);

    expect(lines(tree, `${root}/.gitignore`)).toContain(BUNDLE_GLOB);
  });

  it('should leave a project without a rolldown config alone', async () => {
    const root = givenProject(tree, 'lib', { withRolldownConfig: false });

    await migration(tree);

    expect(tree.exists(`${root}/.gitignore`)).toBe(false);
  });

  it('should not duplicate an existing gitignore entry', async () => {
    const root = givenProject(tree, 'lib');
    tree.write(`${root}/.gitignore`, `dist\n${BUNDLE_GLOB}\n`);

    await migration(tree);

    expect(
      lines(tree, `${root}/.gitignore`).filter((line) => line === BUNDLE_GLOB),
    ).toHaveLength(1);
  });

  it('should keep the entries already in a project gitignore', async () => {
    const root = givenProject(tree, 'lib');
    tree.write(`${root}/.gitignore`, 'generated/prisma\n');

    await migration(tree);

    expect(lines(tree, `${root}/.gitignore`)).toContain('generated/prisma');
    expect(lines(tree, `${root}/.gitignore`)).toContain(BUNDLE_GLOB);
  });

  it('should report a biome config whose includes have diverged', async () => {
    givenProject(tree, 'lib');
    tree.write(
      'biome.json',
      JSON.stringify({ files: { includes: ['**', '!**/node_modules'] } }),
    );

    const result = await migration(tree);

    // Without the anchor the list is the user's, so it is left as it is.
    expect(readJson(tree, 'biome.json').files.includes).not.toContain(
      `!${BUNDLE_GLOB}`,
    );
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain('biome.json');
  });

  it('should leave a workspace without a biome config alone', async () => {
    givenProject(tree, 'lib');
    tree.delete('biome.json');

    const result = await migration(tree);

    expect(tree.exists('biome.json')).toBe(false);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    const root = givenProject(tree, 'lib');

    await migration(tree);
    const afterFirst = {
      biome: read(tree, 'biome.json'),
      gitignore: read(tree, `${root}/.gitignore`),
    };
    const result = await migration(tree);

    expect(read(tree, 'biome.json')).toBe(afterFirst.biome);
    expect(read(tree, `${root}/.gitignore`)).toBe(afterFirst.gitignore);
    expect(result.nextSteps).toEqual([]);
  });
});
