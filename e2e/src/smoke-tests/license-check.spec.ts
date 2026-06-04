/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { ensureDirSync } from 'fs-extra';
import TOML from '@iarna/toml';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
// eslint-disable-next-line
import {
  TS_VERSIONS,
  PY_VERSIONS,
} from '../../../packages/nx-plugin/src/utils/versions';

describe('smoke test - license-check', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/license-check-${pkgMgr}`;
  let projectRoot: string;
  let opts: { cwd: string; env: Record<string, string> };

  beforeAll(async () => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);

    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'license-check-test', 'cdk')} --interactive=false --skipGit`,
      {
        cwd: targetDir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );

    projectRoot = `${targetDir}/license-check-test`;
    opts = {
      cwd: projectRoot,
      env: {
        NX_DAEMON: 'false',
      },
    };

    await runCLI(`generate @aws/nx-plugin:license --no-interactive`, opts);
  });

  it('passes license-check with TS_VERSIONS dependencies', async () => {
    const rootPkgPath = join(projectRoot, 'package.json');
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
    const tsDependencies: Record<string, string> = {};
    for (const [name, version] of Object.entries(TS_VERSIONS)) {
      // Type declarations don't ship license metadata
      if (name.startsWith('@types/')) continue;
      // mariadb is LGPL — used to verify failure detection in a later test
      if (name === 'mariadb') continue;
      // MCP Inspector tarballs omit the LICENSE file — covered by known-exceptions
      if (name.startsWith('@modelcontextprotocol/inspector')) continue;
      tsDependencies[name] = version as string;
    }
    rootPkg.devDependencies = {
      ...rootPkg.devDependencies,
      ...tsDependencies,
    };
    writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

    await runCLI('pnpm install --no-frozen-lockfile --ignore-scripts', {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });

    await runCLI('run-many --target=license-check --all --verbose', opts);
  });

  it('fails license-check when a non-permissive npm dep is added', async () => {
    const rootPkgPath = join(projectRoot, 'package.json');
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
    rootPkg.dependencies = {
      ...rootPkg.dependencies,
      mariadb: '3.5.2',
    };
    writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

    await runCLI('pnpm install --no-frozen-lockfile --ignore-scripts', {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });

    let failed = false;
    try {
      await runCLI('run-many --target=license-check --all --verbose', opts);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('passes license-check when only permissive deps are present', async () => {
    const rootPkgPath = join(projectRoot, 'package.json');
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
    delete rootPkg.dependencies?.mariadb;
    rootPkg.dependencies = {
      ...rootPkg.dependencies,
      chalk: '5.6.2',
    };
    writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

    await runCLI('pnpm install --no-frozen-lockfile --ignore-scripts', {
      ...opts,
      prefixWithPackageManagerCmd: false,
    });

    await runCLI('run-many --target=license-check --all --verbose', opts);
  });

  it('passes license-check with Python dependencies', async () => {
    // Generate a Python project — this adds pythonCollector to the config
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=py-deps --projectType=application --no-interactive`,
      opts,
    );

    // Add a subset of PY_VERSIONS deps to the pyproject.toml
    const pyProjectTomlPath = join(
      projectRoot,
      'packages',
      'py_deps',
      'pyproject.toml',
    );
    const pyToml = TOML.parse(readFileSync(pyProjectTomlPath, 'utf-8'));
    const pyDeps = Object.entries(PY_VERSIONS)
      .filter(
        ([name]) =>
          // These are CLI tools run via uvx, not installed as project deps
          name !== 'checkov' &&
          !name.startsWith('pip-') &&
          // ag-ui-strands ships without license metadata
          !name.includes('ag-ui-strands'),
      )
      .map(([name, version]) => `${name}${version}`);
    (pyToml.project as any).dependencies = pyDeps;
    writeFileSync(pyProjectTomlPath, TOML.stringify(pyToml));

    await runCLI('uv sync --directory packages/py_deps', {
      ...opts,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
    });

    await runCLI('run-many --target=license-check --all --verbose', opts);
  });

  it('fails license-check when a non-permissive Python dep is added', async () => {
    const pyProjectTomlPath = join(
      projectRoot,
      'packages',
      'py_deps',
      'pyproject.toml',
    );
    const pyToml = TOML.parse(readFileSync(pyProjectTomlPath, 'utf-8'));
    // paramiko is LGPL-2.1 — not on the allowlist, so the check must fail
    (pyToml.project as any).dependencies = [
      ...((pyToml.project as any).dependencies ?? []),
      'paramiko==3.5.1',
    ];
    writeFileSync(pyProjectTomlPath, TOML.stringify(pyToml));

    await runCLI('uv sync --directory packages/py_deps', {
      ...opts,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
    });

    let failed = false;
    try {
      await runCLI('run-many --target=license-check --all --verbose', opts);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('passes license-check when the non-permissive Python dep is removed', async () => {
    const pyProjectTomlPath = join(
      projectRoot,
      'packages',
      'py_deps',
      'pyproject.toml',
    );
    const pyToml = TOML.parse(readFileSync(pyProjectTomlPath, 'utf-8'));
    (pyToml.project as any).dependencies = (
      (pyToml.project as any).dependencies ?? []
    ).filter((dep: string) => !dep.startsWith('paramiko'));
    writeFileSync(pyProjectTomlPath, TOML.stringify(pyToml));

    await runCLI('uv sync --directory packages/py_deps', {
      ...opts,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
    });

    await runCLI('run-many --target=license-check --all --verbose', opts);
  });
});
