/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { syncVendedVersions } from '../../utils/version-upgrade-migration/sync-vended-versions';
import { PY_VERSIONS, TS_VERSIONS } from '../../utils/versions';
import {
  internalRollBackVersionsGenerator,
  UNOWNED_PACKAGE,
  UNOWNED_VERSION,
} from './generator';

/**
 * The rollback generator exists to give the version-sync smoke test a workspace
 * that is behind. These tests hold the round trip it depends on: everything it
 * rolls back, the sync must put back.
 */
describe('internal#roll-back-versions generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // Ownership is per generator, so the surfaces under test need a project
    // recording one that declares them.
    addProjectConfiguration(tree, 'owner', {
      root: 'packages/owner',
      metadata: {
        generator: 'ts#trpc-api',
        components: [{ generator: 'py#project' }, { generator: 'py#fast-api' }],
      } as never,
    });
  });

  it('should roll an exact pin back below the vended version', async () => {
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: TS_VERSIONS.zod },
    });

    await internalRollBackVersionsGenerator(tree);

    expect(
      readJson(tree, 'packages/api/package.json').dependencies.zod,
    ).not.toBe(TS_VERSIONS.zod);
  });

  // The sync deliberately leaves a range alone, so rolling one back would set
  // the smoke test up to assert the opposite of the intended behaviour.
  it('should leave a range alone', async () => {
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: '^4.0.0', express: 'catalog:' },
    });

    await internalRollBackVersionsGenerator(tree);

    const { dependencies } = readJson(tree, 'packages/api/package.json');
    expect(dependencies.zod).toBe('^4.0.0');
    expect(dependencies.express).toBe('catalog:');
  });

  it('should plant a dependency no generator owns', async () => {
    await internalRollBackVersionsGenerator(tree);

    expect(
      readJson(tree, 'package.json').devDependencies[UNOWNED_PACKAGE],
    ).toBe(UNOWNED_VERSION);
  });

  // The round trip the smoke test rests on: every surface it rolls back, the
  // sync raises again. Asserted here so a break shows up in the unit suite
  // rather than only in the slow smoke lane.
  it('should be reversed by the version sync on every surface', async () => {
    writeJson(tree, 'packages/api/package.json', {
      name: '@org/api',
      dependencies: { zod: TS_VERSIONS.zod },
      devDependencies: { '@types/cors': TS_VERSIONS['@types/cors'] },
      overrides: { zod: TS_VERSIONS.zod },
      resolutions: { '**/@modelcontextprotocol/sdk/zod': TS_VERSIONS.zod },
      pnpm: { overrides: { zod: TS_VERSIONS.zod } },
    });
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump({
        packages: ['packages/*'],
        catalog: { zod: TS_VERSIONS.zod },
        overrides: { zod: TS_VERSIONS.zod },
      }),
    );
    tree.write(
      'packages/pyapp/pyproject.toml',
      [
        '[project]',
        'name = "pyapp"',
        `dependencies = ["fastapi==${PY_VERSIONS.fastapi.replace('==', '')}"]`,
        '',
      ].join('\n'),
    );

    await internalRollBackVersionsGenerator(tree);

    // Everything is behind now, which is the state the smoke test migrates from.
    const rolled = readJson(tree, 'packages/api/package.json');
    expect(rolled.dependencies.zod).not.toBe(TS_VERSIONS.zod);
    expect(rolled.overrides.zod).not.toBe(TS_VERSIONS.zod);

    await syncVendedVersions(tree);

    const synced = readJson(tree, 'packages/api/package.json');
    expect(synced.dependencies.zod).toBe(TS_VERSIONS.zod);
    expect(synced.devDependencies['@types/cors']).toBe(
      TS_VERSIONS['@types/cors'],
    );
    expect(synced.overrides.zod).toBe(TS_VERSIONS.zod);
    expect(synced.resolutions['**/@modelcontextprotocol/sdk/zod']).toBe(
      TS_VERSIONS.zod,
    );
    expect(synced.pnpm.overrides.zod).toBe(TS_VERSIONS.zod);

    const workspaceFile = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8') ?? '',
    ) as Record<string, Record<string, string>>;
    expect(workspaceFile.catalog.zod).toBe(TS_VERSIONS.zod);
    expect(workspaceFile.overrides.zod).toBe(TS_VERSIONS.zod);

    expect(tree.read('packages/pyapp/pyproject.toml', 'utf-8')).toContain(
      `fastapi==${PY_VERSIONS.fastapi.replace('==', '')}`,
    );

    // The planted dependency is the control: no generator adds it.
    expect(
      readJson(tree, 'package.json').devDependencies[UNOWNED_PACKAGE],
    ).toBe(UNOWNED_VERSION);
  });
});
