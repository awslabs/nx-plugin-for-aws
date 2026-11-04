/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree, updateJson } from '@nx/devkit';
import yaml from 'js-yaml';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../../../utils/config/utils.js';
import {
  formatFilesInSubtree,
  getDefaultBiomeConfig,
} from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { syncVendedVersions } from '../../../utils/version-upgrade-migration/sync-vended-versions.js';
import { TS_VERSIONS } from '../../../utils/versions.js';
import migration from './migration.js';

const FORMATTER_OFF = { formatter: { enabled: false } };

const BIOME = '@biomejs/biome';

/** The Biome version this release vends, which the version sync moves to. */
const VENDED_BIOME = TS_VERSIONS[BIOME];

/** The Biome version vended before 2.6, which rejects the new keys. */
const BIOME_2_5 = '2.5.15';

/** Declares Biome in the root `package.json`, as the generators do. */
const givenRootBiome = (tree: Tree, specifier: string) =>
  updateJson(tree, 'package.json', (json) => ({
    ...json,
    devDependencies: { ...json.devDependencies, [BIOME]: specifier },
  }));

/** Declares Biome through the pnpm catalog, as the generators do. */
const givenCatalogBiome = (tree: Tree, version: string) => {
  const workspaceYaml = yaml.load(
    tree.read('pnpm-workspace.yaml', 'utf-8') ?? '',
  ) as Record<string, unknown>;
  tree.write(
    'pnpm-workspace.yaml',
    yaml.dump({ ...workspaceYaml, catalog: { [BIOME]: version } }),
  );
  givenRootBiome(tree, 'catalog:');
};

const readCatalogBiome = (tree: Tree): string =>
  (
    yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as {
      catalog: Record<string, string>;
    }
  ).catalog[BIOME];

/**
 * Marks the workspace as created by `init`, which owns Biome, so the version
 * sync moves it.
 */
const givenSyncOwnsBiome = (tree: Tree) =>
  tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'export default {};\n');

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
    givenCatalogBiome(tree, VENDED_BIOME);
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

  describe('Biome version guard', () => {
    const expectKeysAdded = (result: { nextSteps?: string[] }) => {
      const biome = readJson(tree, 'biome.json');
      expect(biome.markdown).toEqual(FORMATTER_OFF);
      expect(biome.yaml).toEqual(FORMATTER_OFF);
      expect(result.nextSteps).toEqual([]);
    };

    /** Runs the migration on the pre-2.6 config and expects it to skip. */
    const expectSkipped = async () => {
      givenOldBiomeConfig(tree);
      const before = read(tree, 'biome.json');

      const result = await migration(tree);

      expect(read(tree, 'biome.json')).toBe(before);
      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps?.[0]).toContain('Biome 2.6');
      expect(result.nextSteps?.[0]).toContain(
        '"markdown": { "formatter": { "enabled": false } }',
      );
      expect(result.nextSteps?.[0]).toContain(
        '"yaml": { "formatter": { "enabled": false } }',
      );
    };

    it('should add the keys when Biome 2.6 or later is declared', async () => {
      givenRootBiome(tree, VENDED_BIOME);
      givenOldBiomeConfig(tree);

      expectKeysAdded(await migration(tree));
    });

    it('should add the keys when the version sync moves a catalog Biome 2.5 to the vended version', async () => {
      givenSyncOwnsBiome(tree);
      givenCatalogBiome(tree, BIOME_2_5);
      givenOldBiomeConfig(tree);

      expectKeysAdded(await migration(tree));

      // The sync runs after this migration in `nx migrate`.
      await syncVendedVersions(tree);
      expect(readCatalogBiome(tree)).toBe(VENDED_BIOME);
    });

    it('should add the keys when the version sync moves a direct Biome 2.5 pin to the vended version', async () => {
      givenSyncOwnsBiome(tree);
      givenRootBiome(tree, BIOME_2_5);
      givenOldBiomeConfig(tree);

      expectKeysAdded(await migration(tree));

      await syncVendedVersions(tree);
      expect(readJson(tree, 'package.json').devDependencies[BIOME]).toBe(
        VENDED_BIOME,
      );
    });

    it('should add the keys when the version sync moves a range that excludes the vended version', async () => {
      givenSyncOwnsBiome(tree);
      givenCatalogBiome(tree, `~${BIOME_2_5}`);
      givenOldBiomeConfig(tree);

      expectKeysAdded(await migration(tree));

      await syncVendedVersions(tree);
      expect(readCatalogBiome(tree)).toBe(VENDED_BIOME);
    });

    it('should skip when Biome 2.5 stays because the version sync does not own it', async () => {
      givenCatalogBiome(tree, BIOME_2_5);

      await expectSkipped();

      await syncVendedVersions(tree);
      expect(readCatalogBiome(tree)).toBe(BIOME_2_5);
    });

    it('should skip when a range the version sync leaves alone allows Biome 2.5', async () => {
      givenSyncOwnsBiome(tree);
      givenCatalogBiome(tree, `^${BIOME_2_5}`);

      await expectSkipped();

      await syncVendedVersions(tree);
      expect(readCatalogBiome(tree)).toBe(`^${BIOME_2_5}`);
    });

    it('should resolve a catalog range that starts at Biome 2.6', async () => {
      givenCatalogBiome(tree, `^${VENDED_BIOME}`);
      givenOldBiomeConfig(tree);

      expectKeysAdded(await migration(tree));
    });

    it('should skip when Biome is not declared', async () => {
      updateJson(tree, 'package.json', (json) => {
        delete json.devDependencies[BIOME];
        return json;
      });
      givenSyncOwnsBiome(tree);

      await expectSkipped();
    });

    it('should skip when Biome is a tag the version sync does not own', async () => {
      givenRootBiome(tree, 'latest');

      await expectSkipped();
    });

    it('should add the keys when the version sync replaces a tag with the vended version', async () => {
      givenSyncOwnsBiome(tree);
      givenRootBiome(tree, 'latest');
      givenOldBiomeConfig(tree);

      expectKeysAdded(await migration(tree));

      await syncVendedVersions(tree);
      expect(readJson(tree, 'package.json').devDependencies[BIOME]).toBe(
        VENDED_BIOME,
      );
    });

    it('should not warn when both keys are already present', async () => {
      givenCatalogBiome(tree, BIOME_2_5);
      await formatFilesInSubtree(tree);
      const before = read(tree, 'biome.json');

      const result = await migration(tree);

      expect(read(tree, 'biome.json')).toBe(before);
      expect(result.nextSteps).toEqual([]);
    });
  });
});
