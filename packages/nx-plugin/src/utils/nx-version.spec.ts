/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { type Tree, updateJson, writeJson } from '@nx/devkit';
import yaml from 'js-yaml';
import { major } from 'semver';
import { generatorsJsonEntries } from './generators.js';
import { getPackageVersion } from './nx.js';
import {
  assertSupportedNxVersion,
  readWorkspaceNxVersion,
} from './nx-version.js';
import { createTreeUsingTsSolutionSetup } from './test.js';
import { NX_VERSION } from './versions.js';

// The Nx major the plugin is built against, and a version one major older.
const REQUIRED = major(NX_VERSION);
const OLDER = `${REQUIRED - 1}.3.1`;
const NEWER = `${REQUIRED + 1}.0.0`;

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');

const expectedMessage = (version: string) =>
  `@aws/nx-plugin ${getPackageVersion()} needs Nx ${REQUIRED}, but this workspace has Nx ${version}. Upgrade Nx with: pnpm nx migrate ${NX_VERSION} && pnpm install && pnpm nx migrate --run-migrations`;

const writeInstalledNx = (tree: Tree, version: string) =>
  writeJson(tree, 'node_modules/nx/package.json', { name: 'nx', version });

const setDeclaredNx = (tree: Tree, range: string | undefined) =>
  updateJson(tree, 'package.json', (json) => {
    const { nx: _nx, ...devDependencies } = json.devDependencies ?? {};
    json.devDependencies =
      range === undefined ? devDependencies : { ...devDependencies, nx: range };
    if (json.dependencies) {
      delete json.dependencies.nx;
    }
    return json;
  });

const writeCatalog = (tree: Tree, catalog: Record<string, string>): void => {
  const workspaceYaml =
    (yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8') ?? '') as Record<
      string,
      unknown
    >) ?? {};
  tree.write('pnpm-workspace.yaml', yaml.dump({ ...workspaceYaml, catalog }));
};

const listChanges = (tree: Tree) =>
  tree.listChanges().map((c) => `${c.type} ${c.path}`);

describe('nx version guard', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    setDeclaredNx(tree, undefined);
  });

  it('should throw when the installed nx is an older major', () => {
    writeInstalledNx(tree, OLDER);

    expect(() => assertSupportedNxVersion(tree)).toThrow(
      new Error(expectedMessage(OLDER)),
    );
  });

  it('should pass when the installed nx is the same version', () => {
    writeInstalledNx(tree, NX_VERSION);

    expect(() => assertSupportedNxVersion(tree)).not.toThrow();
  });

  it('should pass when the installed nx is a newer major', () => {
    writeInstalledNx(tree, NEWER);

    expect(() => assertSupportedNxVersion(tree)).not.toThrow();
  });

  it('should prefer the installed nx over the declared range', () => {
    writeInstalledNx(tree, NX_VERSION);
    setDeclaredNx(tree, OLDER);

    expect(readWorkspaceNxVersion(tree)).toBe(NX_VERSION);
    expect(() => assertSupportedNxVersion(tree)).not.toThrow();
  });

  it('should throw on an older declared range when nx is not installed', () => {
    setDeclaredNx(tree, `^${OLDER}`);

    expect(readWorkspaceNxVersion(tree)).toBe(OLDER);
    expect(() => assertSupportedNxVersion(tree)).toThrow(
      new Error(expectedMessage(OLDER)),
    );
  });

  it('should read nx from dependencies when devDependencies has none', () => {
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      dependencies: { ...json.dependencies, nx: OLDER },
    }));

    expect(readWorkspaceNxVersion(tree)).toBe(OLDER);
  });

  it('should resolve a catalog reference to an older nx', () => {
    writeCatalog(tree, { nx: OLDER });
    setDeclaredNx(tree, 'catalog:');

    expect(readWorkspaceNxVersion(tree)).toBe(OLDER);
    expect(() => assertSupportedNxVersion(tree)).toThrow(
      new Error(expectedMessage(OLDER)),
    );
  });

  it('should pass when the catalog has no nx entry', () => {
    writeCatalog(tree, { typescript: '5.9.3' });
    setDeclaredNx(tree, 'catalog:');

    expect(readWorkspaceNxVersion(tree)).toBeUndefined();
    expect(() => assertSupportedNxVersion(tree)).not.toThrow();
  });

  it('should pass when no nx version is installed or declared', () => {
    expect(readWorkspaceNxVersion(tree)).toBeUndefined();
    expect(() => assertSupportedNxVersion(tree)).not.toThrow();
  });

  it('should pass when the installed nx package.json is not JSON', () => {
    tree.write('node_modules/nx/package.json', 'not json');

    expect(readWorkspaceNxVersion(tree)).toBeUndefined();
    expect(() => assertSupportedNxVersion(tree)).not.toThrow();
  });

  it('should pass when the declared range is compound', () => {
    setDeclaredNx(tree, `>=${REQUIRED - 1} <${REQUIRED + 1}`);

    expect(readWorkspaceNxVersion(tree)).toBeUndefined();
    expect(() => assertSupportedNxVersion(tree)).not.toThrow();
  });

  it('should warn once per process when the version is unknown', async () => {
    vi.resetModules();
    const { logger } = await import('@nx/devkit');
    const fresh = await import('./nx-version.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      fresh.assertSupportedNxVersion(tree);
      fresh.assertSupportedNxVersion(tree);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('@aws/nx-plugin');
      expect(warn.mock.calls[0][0]).toContain(`Nx ${REQUIRED}`);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('every generator', () => {
  const generatorIds = Object.keys(generatorsJsonEntries).filter(
    (id) => id !== 'preset',
  );

  it.each(generatorIds)(
    '%s should refuse an older nx major before writing a file',
    async (id) => {
      const factory = path.resolve(
        PLUGIN_ROOT,
        `${generatorsJsonEntries[id].factory}.ts`,
      );
      const generator = (await import(factory)).default;
      const tree = createTreeUsingTsSolutionSetup();
      writeInstalledNx(tree, OLDER);
      const before = listChanges(tree);

      await expect(async () => generator(tree, {})).rejects.toThrow('needs Nx');
      expect(listChanges(tree)).toEqual(before);
    },
  );

  it('should exempt the preset, which creates the workspace', () => {
    const presetSource = readFileSync(
      path.resolve(PLUGIN_ROOT, `${generatorsJsonEntries.preset.factory}.ts`),
      'utf-8',
    );

    expect(presetSource).not.toContain('assertSupportedNxVersion');
  });
});
