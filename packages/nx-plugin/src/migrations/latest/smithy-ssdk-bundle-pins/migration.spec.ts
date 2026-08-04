/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { smithyProjectGenerator } from '../../../smithy/project/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { TS_VERSIONS } from '../../../utils/versions';
import migration from './migration';

const BUILD_DOCKERFILE = 'test-api/build.Dockerfile';

// The versions the pins were on before this release vended their replacements.
const OLD_ROLLDOWN = '1.0.0-beta.38';
const OLD_DTS = '0.16.5';

/**
 * A `build.Dockerfile` as an older release generated it: the real template,
 * rendered by the real generator, with only the pins wound back. Asserting
 * against a hand-written fixture would pass even if the template's shape moved
 * out from under the migration.
 */
const generateOldWorkspace = async (tree: Tree): Promise<void> => {
  await smithyProjectGenerator(tree, { name: 'test-api' });
  const current = tree.read(BUILD_DOCKERFILE, 'utf-8') ?? '';
  tree.write(
    BUILD_DOCKERFILE,
    current
      .replace(`rolldown@${TS_VERSIONS.rolldown}`, `rolldown@${OLD_ROLLDOWN}`)
      .replace(
        `rolldown-plugin-dts@${TS_VERSIONS['rolldown-plugin-dts']}`,
        `rolldown-plugin-dts@${OLD_DTS}`,
      ),
  );
};

describe('smithy-ssdk-bundle-pins migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should move the pins an older release generated onto the vended versions', async () => {
    await generateOldWorkspace(tree);

    const { nextSteps } = await migration(tree);

    const dockerfile = tree.read(BUILD_DOCKERFILE, 'utf-8') ?? '';
    expect(dockerfile).toContain(`rolldown@${TS_VERSIONS.rolldown}`);
    expect(dockerfile).toContain(
      `rolldown-plugin-dts@${TS_VERSIONS['rolldown-plugin-dts']}`,
    );
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
    expect(dockerfile).toContain(
      `@rollup/plugin-esm-shim@${TS_VERSIONS['@rollup/plugin-esm-shim']}`,
    );
    expect(dockerfile).toContain('pnpm@11.1.1');
    expect(dockerfile).toContain('smithy/releases/download/1.61.0/');
  });

  it('should leave a workspace already on the vended versions untouched', async () => {
    await smithyProjectGenerator(tree, { name: 'test-api' });
    const before = tree.read(BUILD_DOCKERFILE, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read(BUILD_DOCKERFILE, 'utf-8')).toEqual(before);
    expect(nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generateOldWorkspace(tree);

    await migration(tree);
    const afterFirst = tree.read(BUILD_DOCKERFILE, 'utf-8');
    await migration(tree);

    expect(tree.read(BUILD_DOCKERFILE, 'utf-8')).toEqual(afterFirst);
  });

  // The shapes build image builds the model alone and pins none of this.
  it('should leave a build image that bundles no SSDK alone', async () => {
    await smithyProjectGenerator(tree, { name: 'test-shapes', type: 'shapes' });
    const before = tree.read('test-shapes/build.Dockerfile', 'utf-8');

    await migration(tree);

    expect(tree.read('test-shapes/build.Dockerfile', 'utf-8')).toEqual(before);
  });

  it('should do nothing in a workspace with no smithy project', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
  });
});
