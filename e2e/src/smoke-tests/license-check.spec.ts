/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { ensureDirSync } from 'fs-extra';
import {
  buildCreateNxWorkspaceCommand,
  runCLI,
  tmpProjPath,
  TS_VERSIONS,
  PY_VERSIONS,
} from '../utils';

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
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'license-check-test', 'CDK')} --interactive=false --skipGit`,
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

  it('passes license-check with all TS versions.ts dependencies', async () => {
    const rootPkgPath = join(projectRoot, 'package.json');
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
    const tsDependencies: Record<string, string> = {};
    for (const [name, version] of Object.entries(TS_VERSIONS)) {
      if (name.startsWith('@types/')) continue;
      // mariadb is LGPL — documented in RDB guide, not in default allowlist
      if (name === 'mariadb') continue;
      // MCP Inspector ships without LICENSE file — covered by exception
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

    await runCLI('run-many --target=license-check --all', opts);
  });

  it('passes license-check with all Python versions.ts dependencies', async () => {
    await runCLI(
      `generate @aws/nx-plugin:py#project --name=py-deps --projectType=application --no-interactive`,
      opts,
    );

    const pyProjectTomlPath = join(
      projectRoot,
      'packages',
      'py_deps',
      'pyproject.toml',
    );
    const pyToml = readFileSync(pyProjectTomlPath, 'utf-8');
    // Exclude checkov (run via uvx, not installed) and ag-ui-strands
    // (ships without license metadata — covered by exception from py#agent)
    const pyDeps = Object.entries(PY_VERSIONS)
      .filter(([name]) => name !== 'checkov' && !name.includes('ag-ui-strands'))
      .map(([name, version]) => `"${name}${version}"`)
      .join(',\n    ');
    const updatedToml = pyToml.replace(
      /^dependencies\s*=\s*\[.*?\]/ms,
      `dependencies = [\n    ${pyDeps}\n]`,
    );
    writeFileSync(pyProjectTomlPath, updatedToml);

    await runCLI('uv sync --directory packages/py_deps', {
      ...opts,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
    });

    await runCLI('run-many --target=license-check --all', opts);
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
      await runCLI('run-many --target=license-check --all', opts);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('passes license-check when a permissive dep is added', async () => {
    const rootPkgPath = join(projectRoot, 'package.json');
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
    // Remove mariadb, add a known-good MIT dep
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

    await runCLI('run-many --target=license-check --all', opts);
  });
});
