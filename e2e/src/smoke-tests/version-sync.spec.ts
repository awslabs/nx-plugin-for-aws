/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { load } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line
import {
  UNOWNED_PACKAGE,
  UNOWNED_VERSION,
} from '../../../packages/nx-plugin/src/internal/roll-back-versions/generator';
// eslint-disable-next-line
import {
  PY_VERSIONS,
  TS_VERSIONS,
} from '../../../packages/nx-plugin/src/utils/versions';
import { createTestWorkspace, runCLI, runInstall, tmpProjPath } from '../utils';
import { activatePackageManagerViaCorepack } from './corepack';

/**
 * Smoke test for the version sync migration, on a real generated workspace.
 *
 * The unit tests drive `syncVendedVersions` against a synthetic tree. This runs
 * it over the manifests, pyprojects and `.tf` files the generators actually
 * produce, so it catches what a fixture can't: a surface no generator writes the
 * way the tests assume, and ownership resolved from the metadata the generators
 * really recorded rather than a hand-written fixture.
 *
 * `internal#roll-back-versions` puts the workspace behind first. Publishing an
 * older plugin would tie the assertions to whatever that release vended;
 * rolling back in place keeps them derived from the current tables, so nothing
 * here hardcodes a version.
 *
 * The migration is invoked directly rather than through `nx migrate`, which
 * needs two published versions and a release window — covered separately. What
 * this holds is the sync's own contract: every owned pin moves up, and nothing
 * else moves at all.
 */
describe('smoke test - version-sync', () => {
  // yarn, because the generators only write a resolution under yarn (rdb's
  // `@types/pg` and mcp-server's `zod`) — a pnpm workspace would never exercise
  // the override path this covers.
  const pkgMgr = 'yarn';
  const targetDir = `${tmpProjPath()}/version-sync-${pkgMgr}`;
  let projectRoot: string;
  let opts: { cwd: string; env: Record<string, string | undefined> };

  const readJsonFile = (path: string): Record<string, any> =>
    JSON.parse(readFileSync(join(projectRoot, path), 'utf-8'));

  // pnpm keeps its catalog in `pnpm-workspace.yaml`, yarn in `.yarnrc.yml`.
  const readCatalog = (): Record<string, string> => {
    for (const file of ['.yarnrc.yml', 'pnpm-workspace.yaml']) {
      const path = join(projectRoot, file);
      if (!existsSync(path)) {
        continue;
      }
      const catalog = (
        load(readFileSync(path, 'utf-8')) as {
          catalog?: Record<string, string>;
        }
      )?.catalog;
      if (catalog) {
        return catalog;
      }
    }
    return {};
  };

  let restorePackageManager: (() => void) | undefined;

  afterAll(() => {
    restorePackageManager?.();
    // Kept on failure so the workspace can be inspected.
    if (!process.env.NX_E2E_KEEP_WORKSPACE && existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
  });

  beforeAll(
    async () => {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
      // Pin the @aws scope to verdaccio so the create package resolves the build
      // just published rather than the public `latest` tag.
      const localRegistry = process.env.NX_E2E_LOCAL_REGISTRY;
      if (localRegistry) {
        writeFileSync(
          join(targetDir, '.npmrc'),
          [
            `@aws:registry=${localRegistry}`,
            `//${localRegistry.replace(/^https?:\/\//, '').replace(/\/$/, '')}/:_authToken=secretVerdaccioToken`,
            '',
          ].join('\n'),
        );
      }
      // Hardened mode and immutable installs are auto-enabled under CI and would
      // refuse the lockfile writes a fresh workspace needs.
      restorePackageManager = activatePackageManagerViaCorepack('yarn', 4, {
        YARN_ENABLE_HARDENED_MODE: '0',
        YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
      });
      projectRoot = await createTestWorkspace(
        pkgMgr,
        targetDir,
        'version-sync-test',
        'cdk',
      );
      // yarn 4 refuses packages published within its default age gate.
      appendFileSync(
        join(projectRoot, '.yarnrc.yml'),
        '\nnpmMinimalAgeGate: "0"\n',
      );
      opts = {
        cwd: projectRoot,
        env: {
          NX_DAEMON: 'false',
          NODE_OPTIONS: '--max-old-space-size=8192',
        },
      };

      // A slice broad enough to cover every surface the sync touches: a
      // TypeScript API (catalog + project manifests), a Python API (pyproject
      // pins), infra (CDK metrics) and an MCP server (a yarn resolution).
      const defer = ' --prefer-install-dependencies=false';
      await runCLI(
        `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive${defer}`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive${defer}`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:py#api --name=py-api --infra=rest-lambda --no-interactive${defer}`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive${defer}`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp --infra=none --no-interactive${defer}`,
        opts,
      );
      await runInstall(opts);
    },
    20 * 60 * 1000,
  );

  it('should raise every owned pin the workspace had fallen behind on', async () => {
    // Roll the workspace behind, so there is something to upgrade.
    await runCLI(
      `generate @aws/nx-plugin:internal#roll-back-versions --no-interactive`,
      opts,
    );

    // Sanity check the rollback did something, or the assertions below would
    // pass against a workspace that was never behind.
    const rolledCatalog = readCatalog();
    expect(rolledCatalog.zod).toBeDefined();
    expect(rolledCatalog.zod).not.toBe(TS_VERSIONS.zod);

    // Run the sync exactly as `nx migrate --run-migrations` would.
    await runCLI(
      `generate @aws/nx-plugin:internal#sync-vended-versions --no-interactive`,
      opts,
    );

    // TypeScript: the catalog every project manifest references.
    expect(readCatalog().zod).toBe(TS_VERSIONS.zod);

    // The resolution `ts#mcp-server` writes under yarn, scoped to the SDK whose
    // own peer range would otherwise resolve a second, incompatible zod. Devkit
    // does not manage this field, so only the override sync reaches it.
    //
    // The bare descriptor: berry deletes the `**/`-prefixed one on install, and
    // classic honours only that one, so the generator writes both.
    const rootPackageJson = readJsonFile('package.json');
    expect(rootPackageJson.resolutions['@modelcontextprotocol/sdk/zod']).toBe(
      TS_VERSIONS.zod,
    );

    // Python: `==` pins in a generated pyproject. The directory is the module
    // name (snake_case), so read it rather than assume the project name.
    const pyProject = readFileSync(
      join(projectRoot, 'packages/py_api/pyproject.toml'),
      'utf-8',
    );
    expect(pyProject).toContain(
      `fastapi==${PY_VERSIONS.fastapi.replace('==', '')}`,
    );

    // A dependency no generator adds keeps the version the user chose.
    expect(rootPackageJson.devDependencies[UNOWNED_PACKAGE]).toBe(
      UNOWNED_VERSION,
    );
  });

  it('should leave the workspace building after the sync', async () => {
    await runInstall(opts);
    await runCLI('sync', opts);
    await runInstall(opts);

    const buildOutput = await runCLI(
      'run-many --target build --all --output-style=stream --skip-nx-cache',
      opts,
    );
    expect(buildOutput).toContain('Successfully ran target build');
  });
});
