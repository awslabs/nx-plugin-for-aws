/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { smithyProjectGenerator } from '../../../smithy/project/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const BUILD_DOCKERFILE = 'test-api/build.Dockerfile';

// The versions this migration moves the pins to, hardcoded here as they are in
// the migration: a once-off change stays fixed however far the vended versions
// move afterwards.
const ROLLDOWN = '1.2.0';
const DTS = '0.28.0';
const ESM_SHIM = '0.1.8';

// The versions an older release generated.
const OLD_ROLLDOWN = '1.0.0-beta.38';
const OLD_DTS = '0.16.5';

/**
 * The `build.Dockerfile` a v1.0.0-rc.57 workspace holds.
 *
 * A snapshot of that release's rendered template rather than the generator's
 * output: Smithy projects now build with the Smithy CLI on the machine and vend no
 * Dockerfile at all, so there is nothing left to render. This migration exists
 * only for a workspace still on the container build, and the file it has is fixed
 * — pinning the input here is what it actually runs against.
 */
const RC57_BUILD_DOCKERFILE = readFileSync(
  join(import.meta.dirname, 'rc57-service.Dockerfile.fixture'),
  'utf-8',
);

/** A Smithy service project as v1.0.0-rc.57 left it. */
const generateOldWorkspace = async (tree: Tree): Promise<void> => {
  await smithyProjectGenerator(tree, { name: 'test-api' });
  tree.write(BUILD_DOCKERFILE, RC57_BUILD_DOCKERFILE);
};

describe('smithy-ssdk-bundle-pins migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should move the pins an older release generated onto the fixed versions', async () => {
    await generateOldWorkspace(tree);

    const { nextSteps } = await migration(tree);

    const dockerfile = tree.read(BUILD_DOCKERFILE, 'utf-8') ?? '';
    expect(dockerfile).toContain(`rolldown@${ROLLDOWN}`);
    expect(dockerfile).toContain(`rolldown-plugin-dts@${DTS}`);
    expect(dockerfile).not.toContain(`rolldown@${OLD_ROLLDOWN}`);
    expect(dockerfile).not.toContain(`rolldown-plugin-dts@${OLD_DTS}`);
    expect(nextSteps).toEqual([]);
  });

  // `rolldown-plugin-dts` and `@rollup/plugin-esm-shim` sit in the same command,
  // and `rolldown` is a prefix of the plugin's name, so a pin matched loosely
  // would rewrite the wrong version.
  it('should leave the other pins in the same command alone', async () => {
    await generateOldWorkspace(tree);

    await migration(tree);

    const dockerfile = tree.read(BUILD_DOCKERFILE, 'utf-8') ?? '';
    expect(dockerfile).toContain(`@rollup/plugin-esm-shim@${ESM_SHIM}`);
    expect(dockerfile).toContain('pnpm@11.1.1');
    expect(dockerfile).toContain('smithy/releases/download/1.61.0/');
  });

  it('should leave a workspace already on the fixed versions untouched', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });
    const onTarget = RC57_BUILD_DOCKERFILE.replace(
      /rolldown@[^\s\\]+/,
      `rolldown@${ROLLDOWN}`,
    ).replace(/rolldown-plugin-dts@[^\s\\]+/, `rolldown-plugin-dts@${DTS}`);
    tree.write(BUILD_DOCKERFILE, onTarget);

    const { nextSteps } = await migration(tree);

    expect(tree.read(BUILD_DOCKERFILE, 'utf-8')).toEqual(onTarget);
    expect(nextSteps).toEqual([]);
  });

  // A later release's version sync moves these pins on past the target, and this
  // migration still runs on the way through — it must not wind them back.
  it('should leave a pin a later release moved past the target alone', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });
    const newer = RC57_BUILD_DOCKERFILE.replace(
      /rolldown@[^\s\\]+/,
      'rolldown@9.9.9',
    ).replace(/rolldown-plugin-dts@[^\s\\]+/, 'rolldown-plugin-dts@9.9.9');
    tree.write(BUILD_DOCKERFILE, newer);

    const { nextSteps } = await migration(tree);

    expect(tree.read(BUILD_DOCKERFILE, 'utf-8')).toEqual(newer);
    expect(nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generateOldWorkspace(tree);

    await migration(tree);
    const afterFirst = tree.read(BUILD_DOCKERFILE, 'utf-8');
    await migration(tree);

    expect(tree.read(BUILD_DOCKERFILE, 'utf-8')).toEqual(afterFirst);
  });

  // The shapes type builds the model alone and pins none of this.
  it('should leave a shapes project alone', async () => {
    await smithyProjectGenerator(tree, { name: 'test-shapes', type: 'shapes' });
    // A rc.57 shape library's Dockerfile, which pins the CLI but nothing else.
    const before = `FROM public.ecr.aws/docker/library/node:24 AS builder\nRUN npm i -g rolldown@${OLD_ROLLDOWN}\n`;
    tree.write('test-shapes/build.Dockerfile', before);

    await migration(tree);

    expect(tree.read('test-shapes/build.Dockerfile', 'utf-8')).toEqual(before);
  });

  // Scoped by the recorded generator id, so a `build.Dockerfile` a user wrote
  // themselves keeps whatever it pins.
  it('should leave a build.Dockerfile outside a smithy project alone', async () => {
    await generateOldWorkspace(tree);
    addProjectConfiguration(tree, 'other', { root: 'packages/other' });
    const theirs = `FROM node:24\nRUN npm i -g rolldown@${OLD_ROLLDOWN}\nRUN pnpm add -D rolldown-plugin-dts@${OLD_DTS}\n`;
    tree.write('packages/other/build.Dockerfile', theirs);

    await migration(tree);

    expect(tree.read('packages/other/build.Dockerfile', 'utf-8')).toEqual(
      theirs,
    );
    // The smithy project's own file still migrated.
    expect(tree.read(BUILD_DOCKERFILE, 'utf-8')).toContain(
      `rolldown@${ROLLDOWN}`,
    );
  });

  it('should do nothing in a workspace with no smithy project', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
  });
});
