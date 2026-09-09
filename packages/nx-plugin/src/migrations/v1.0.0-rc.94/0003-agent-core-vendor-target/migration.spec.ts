/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PKG = 'dist/packages/agent/package/agent/my-agent';
const VENDOR = 'dist/packages/agent/agent-core-vendor';
const INSTALL = `npm install --prefix ${PKG} --no-save --no-audit --no-fund --omit=dev @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.12.0`;

/** The packaging target as the generator vended it before the split. */
const packageTarget = () => ({
  cache: true,
  inputs: ['default'],
  outputs: [`{workspaceRoot}/${PKG}`],
  executor: 'nx:run-commands',
  options: {
    commands: [
      `shx rm -rf ${PKG}`,
      `shx mkdir -p ${PKG}`,
      `shx cp dist/packages/agent/bundle/agent/my-agent/index.js ${PKG}/index.js`,
      INSTALL,
    ],
    parallel: false,
  },
  dependsOn: ['bundle'],
});

const addAgent = (tree: Tree, target = packageTarget()) =>
  addProjectConfiguration(tree, 'agent', {
    root: 'packages/agent',
    targets: { 'my-agent-package': target },
  });

const targetsOf = (tree: Tree) =>
  readProjectConfiguration(tree, 'agent').targets!;

describe('agent-core-vendor-target migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should move the install into its own uncached-by-source target', async () => {
    addAgent(tree);

    await migration(tree);

    const vendor = targetsOf(tree)['agent-core-vendor'];
    expect(vendor.inputs).toEqual([]);
    expect(vendor.outputs).toEqual([`{workspaceRoot}/${VENDOR}`]);
    expect(vendor.options.commands).toEqual([
      `shx rm -rf ${VENDOR}`,
      `shx mkdir -p ${VENDOR}`,
      `npm install --prefix ${VENDOR} --no-save --no-audit --no-fund --omit=dev @aws/aws-distro-opentelemetry-node-autoinstrumentation@0.12.0`,
    ]);
  });

  it('should replace the install with a copy of the vendored tree', async () => {
    addAgent(tree);

    await migration(tree);

    const pkg = targetsOf(tree)['my-agent-package'];
    expect(pkg.options.commands).toEqual([
      `shx rm -rf ${PKG}`,
      `shx mkdir -p ${PKG}`,
      `shx cp dist/packages/agent/bundle/agent/my-agent/index.js ${PKG}/index.js`,
      `shx cp -R ${VENDOR}/node_modules/. ${PKG}/node_modules`,
    ]);
    expect(pkg.dependsOn).toEqual(['bundle', 'agent-core-vendor']);
  });

  it('should keep the vendor output outside the package output', async () => {
    addAgent(tree);

    await migration(tree);

    const targets = targetsOf(tree);
    const vendorOut = targets['agent-core-vendor'].outputs![0];
    const packageOut = targets['my-agent-package'].outputs![0];
    // Either nested inside the other would have each wipe the other on a cache hit.
    expect(vendorOut.startsWith(packageOut)).toBe(false);
    expect(packageOut.startsWith(vendorOut)).toBe(false);
  });

  it('should share one vendor target across every code package in a project', async () => {
    const second = packageTarget();
    const secondPkg = 'dist/packages/agent/package/mcp/my-mcp';
    second.outputs = [`{workspaceRoot}/${secondPkg}`];
    second.options.commands = [
      `shx rm -rf ${secondPkg}`,
      `shx mkdir -p ${secondPkg}`,
      `shx cp dist/packages/agent/bundle/mcp/my-mcp/index.js ${secondPkg}/index.js`,
      INSTALL.replace(PKG, secondPkg),
    ];
    addProjectConfiguration(tree, 'agent', {
      root: 'packages/agent',
      targets: {
        'my-agent-package': packageTarget(),
        'my-mcp-package': second,
      },
    });

    await migration(tree);

    const targets = targetsOf(tree);
    expect(
      Object.keys(targets).filter((t) => t === 'agent-core-vendor'),
    ).toHaveLength(1);
    for (const name of ['my-agent-package', 'my-mcp-package']) {
      expect(targets[name].options.commands).toContain(
        `shx cp -R ${VENDOR}/node_modules/. ${
          name === 'my-agent-package' ? PKG : secondPkg
        }/node_modules`,
      );
    }
  });

  it('should preserve a pinned version other than the current one', async () => {
    const target = packageTarget();
    target.options.commands = [
      `shx rm -rf ${PKG}`,
      `shx mkdir -p ${PKG}`,
      `shx cp dist/packages/agent/bundle/agent/my-agent/index.js ${PKG}/index.js`,
      INSTALL.replace('@0.12.0', '@0.9.0'),
    ];
    addAgent(tree, target);

    await migration(tree);

    expect(targetsOf(tree)['agent-core-vendor'].options.commands[2]).toContain(
      '@0.9.0',
    );
  });

  it('should leave a reworked target untouched and report it', async () => {
    const target = packageTarget();
    // No copy to model the replacement on, so the shape is not the vended one.
    target.options.commands = [
      `shx rm -rf ${PKG}`,
      `shx mkdir -p ${PKG}`,
      INSTALL,
    ];
    addAgent(tree, target);

    const { nextSteps } = await migration(tree);

    expect(targetsOf(tree)['my-agent-package'].options.commands).toContain(
      INSTALL,
    );
    expect(targetsOf(tree)['agent-core-vendor']).toBeUndefined();
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('my-agent-package');
  });

  it('should leave a project with no code package alone', async () => {
    addProjectConfiguration(tree, 'agent', {
      root: 'packages/agent',
      targets: {
        'my-agent-docker': {
          executor: 'nx:run-commands',
          options: { commands: ['docker build -t img .'] },
        },
      },
    });

    const { nextSteps } = await migration(tree);

    expect(targetsOf(tree)['agent-core-vendor']).toBeUndefined();
    expect(nextSteps).toHaveLength(0);
  });

  it('should be a no-op on a second run', async () => {
    addAgent(tree);

    await migration(tree);
    const afterFirst = JSON.stringify(targetsOf(tree));
    const { nextSteps } = await migration(tree);

    expect(JSON.stringify(targetsOf(tree))).toEqual(afterFirst);
    expect(nextSteps).toHaveLength(0);
  });
});
