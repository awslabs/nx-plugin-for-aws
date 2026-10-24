/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateFiles } from '@nx/devkit';
import { createTree } from '@nx/devkit/testing';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const loadTemplate = (): string => {
  const tree = createTree();
  generateFiles(
    tree,
    join(import.meta.dirname, 'files', 'scripts'),
    'rendered',
    {},
  );
  const rendered = tree.read('rendered/vendor-crt-addon.ts', 'utf-8');
  if (rendered === null) {
    throw new Error('Template did not produce rendered/vendor-crt-addon.ts');
  }
  return rendered;
};

const transpileTemplate = (): string =>
  ts.transpileModule(loadTemplate(), {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;

const FAKE_ADDON_BYTES = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]);

describe('greengrass vendor-crt-addon.ts', () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'greengrass-vendor-crt-addon-'));
    const scriptsDir = mkdtempSync(
      join(import.meta.dirname, '.tmp-vendor-crt-addon-'),
    );
    scriptPath = join(scriptsDir, 'vendor-crt-addon.mjs');
    writeFileSync(scriptPath, transpileTemplate());
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(join(scriptPath, '..'), { recursive: true, force: true });
  });

  /**
   * A pnpm-isolated-linker-shaped tree: aws-iot-device-sdk-v2 sits in
   * `<projectRoot>/node_modules`, and aws-crt is reachable ONLY through the
   * SDK's own nested `node_modules` - never hoisted to the project's top
   * level - which is what makes the two-hop `packageRoot` walk load-bearing.
   *
   * `sdkPackageJson` defaults to a plain `package.json`; a test may pass an
   * `exports`-map shaped one instead to exercise the walk-up fallback.
   */
  function buildFakeTree(
    addonDirs: readonly string[],
    sdkPackageJson?: Record<string, unknown>,
  ): { projectRoot: string } {
    const projectRoot = join(tmpDir, 'project');
    const sdkDir = join(projectRoot, 'node_modules', 'aws-iot-device-sdk-v2');
    const crtDir = join(sdkDir, 'node_modules', 'aws-crt');
    mkdirSync(sdkDir, { recursive: true });
    mkdirSync(crtDir, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{"name":"project"}\n');
    writeFileSync(
      join(sdkDir, 'package.json'),
      JSON.stringify(
        sdkPackageJson ?? { name: 'aws-iot-device-sdk-v2', main: 'index.js' },
      ),
    );
    writeFileSync(join(sdkDir, 'index.js'), 'export default {};\n');
    writeFileSync(
      join(crtDir, 'package.json'),
      JSON.stringify({ name: 'aws-crt', main: 'index.js' }),
    );
    writeFileSync(join(crtDir, 'index.js'), 'export default {};\n');
    for (const addonDir of addonDirs) {
      const binDir = join(crtDir, 'dist', 'bin', addonDir);
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, 'aws-crt-nodejs.node'), FAKE_ADDON_BYTES);
    }
    return { projectRoot };
  }

  function writeBundle(bundleDir: string): void {
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'index.js'), 'console.log("bundled");\n');
  }

  function run(
    args: readonly string[],
    cwd?: string,
  ): {
    status: number | null;
    stderr: string;
  } {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf-8',
      cwd,
    });
    return { status: result.status, stderr: result.stderr };
  }

  it('should stage the bundle plus one addon dir', () => {
    const { projectRoot } = buildFakeTree(['linux-arm64-glibc']);
    const bundleDir = join(tmpDir, 'bundle');
    const stageDir = join(tmpDir, 'stage');
    writeBundle(bundleDir);

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-arm64-glibc',
    ]);

    expect(status, stderr).toBe(0);
    expect(readFileSync(join(stageDir, 'index.js'), 'utf-8')).toBe(
      'console.log("bundled");\n',
    );
    expect(
      readFileSync(
        join(
          stageDir,
          'native',
          'aws-crt',
          'linux-arm64-glibc',
          'aws-crt-nodejs.node',
        ),
      ),
    ).toEqual(FAKE_ADDON_BYTES);
  });

  it('should stage both addon dirs for a multi-architecture component', () => {
    const { projectRoot } = buildFakeTree([
      'linux-x64-glibc',
      'linux-arm64-glibc',
    ]);
    const bundleDir = join(tmpDir, 'bundle');
    const stageDir = join(tmpDir, 'stage');
    writeBundle(bundleDir);

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-x64-glibc,linux-arm64-glibc',
    ]);

    expect(status, stderr).toBe(0);
    for (const addonDir of ['linux-x64-glibc', 'linux-arm64-glibc']) {
      expect(
        existsSync(
          join(stageDir, 'native', 'aws-crt', addonDir, 'aws-crt-nodejs.node'),
        ),
      ).toBe(true);
    }
  });

  it('should remove a stale stage dir rather than merge into it', () => {
    const { projectRoot } = buildFakeTree(['linux-arm64-glibc']);
    const bundleDir = join(tmpDir, 'bundle');
    const stageDir = join(tmpDir, 'stage');
    writeBundle(bundleDir);
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'stale-from-a-previous-run.txt'), 'stale\n');

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-arm64-glibc',
    ]);

    expect(status, stderr).toBe(0);
    expect(existsSync(join(stageDir, 'stale-from-a-previous-run.txt'))).toBe(
      false,
    );
    expect(existsSync(join(stageDir, 'index.js'))).toBe(true);
  });

  it('should exit 1 and name the missing addon dir and its available siblings', () => {
    const { projectRoot } = buildFakeTree(['linux-arm64-glibc']);
    const bundleDir = join(tmpDir, 'bundle');
    const stageDir = join(tmpDir, 'stage');
    writeBundle(bundleDir);

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-x64-glibc',
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain('linux-x64-glibc');
    expect(stderr).toContain(join('node_modules', 'aws-iot-device-sdk-v2'));
    expect(stderr).toContain('linux-arm64-glibc');
  });

  it('should exit 1 with the package-root message when the SDK cannot be resolved', () => {
    // No node_modules at all under this projectRoot.
    const projectRoot = join(tmpDir, 'project');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{"name":"project"}\n');
    const bundleDir = join(tmpDir, 'bundle');
    const stageDir = join(tmpDir, 'stage');
    writeBundle(bundleDir);

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-arm64-glibc',
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain(
      'Cannot locate the package root of "aws-iot-device-sdk-v2"',
    );
  });

  it('should exit 1 when the bundle already writes the addon path', () => {
    const { projectRoot } = buildFakeTree(['linux-arm64-glibc']);
    const bundleDir = join(tmpDir, 'bundle');
    const stageDir = join(tmpDir, 'stage');
    writeBundle(bundleDir);
    const collidingDir = join(
      bundleDir,
      'native',
      'aws-crt',
      'linux-arm64-glibc',
    );
    mkdirSync(collidingDir, { recursive: true });
    writeFileSync(join(collidingDir, 'aws-crt-nodejs.node'), 'not the addon');

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-arm64-glibc',
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain('Refusing to overwrite');
  });

  it('should exit 1 naming the bundle target when the bundle dir does not exist', () => {
    const { projectRoot } = buildFakeTree(['linux-arm64-glibc']);
    const bundleDir = join(tmpDir, 'bundle-never-built');
    const stageDir = join(tmpDir, 'stage');

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-arm64-glibc',
    ]);

    expect(status).toBe(1);
    expect(stderr).toContain('"bundle" target');
  });

  /**
   * The exact shape Nx runs this target in: the command's cwd is the workspace
   * root and every path argument is workspace-relative, because `{projectRoot}`
   * expands to a relative path. `createRequire` accepts only an absolute path
   * or a file URL, so the script has to make the project root absolute itself.
   */
  it('should accept a workspace-relative project root, as the vendor target passes it', () => {
    buildFakeTree(['linux-arm64-glibc']);
    writeBundle(join(tmpDir, 'bundle'));

    const { status, stderr } = run(
      ['project', 'bundle', 'stage', 'linux-arm64-glibc'],
      tmpDir,
    );

    expect(status, stderr).toBe(0);
    expect(
      existsSync(
        join(
          tmpDir,
          'stage',
          'native',
          'aws-crt',
          'linux-arm64-glibc',
          'aws-crt-nodejs.node',
        ),
      ),
    ).toBe(true);
  });

  it('should resolve the SDK package root via the walk-up fallback when exports hides package.json', () => {
    const { projectRoot } = buildFakeTree(['linux-arm64-glibc'], {
      name: 'aws-iot-device-sdk-v2',
      exports: { '.': './index.js' },
    });
    const bundleDir = join(tmpDir, 'bundle');
    const stageDir = join(tmpDir, 'stage');
    writeBundle(bundleDir);

    const { status, stderr } = run([
      projectRoot,
      bundleDir,
      stageDir,
      'linux-arm64-glibc',
    ]);

    expect(status, stderr).toBe(0);
    expect(
      existsSync(
        join(
          stageDir,
          'native',
          'aws-crt',
          'linux-arm64-glibc',
          'aws-crt-nodejs.node',
        ),
      ),
    ).toBe(true);
  });
});
