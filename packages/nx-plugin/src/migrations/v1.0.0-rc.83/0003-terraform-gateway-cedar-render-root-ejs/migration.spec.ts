/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { TS_VERSIONS } from '../../../utils/versions.js';
import migration from './migration.js';

const SCRIPT_PATH =
  'packages/common/terraform/src/app/gateways/my-gateway/render-cedar.cjs';
const MANIFEST_PATH = 'packages/my-gateway/package.json';

const rootEjs = (tree: Tree) => {
  const root = JSON.parse(tree.read('package.json', 'utf-8')!);
  return root.devDependencies?.ejs ?? root.dependencies?.ejs;
};

describe('terraform-gateway-cedar-render-root-ejs migration', () => {
  let tree: Tree;

  const addGateway = (options: { script?: boolean } = {}) => {
    addProjectConfiguration(tree, '@proj/my-gateway', {
      root: 'packages/my-gateway',
      metadata: {
        generator: AGENTCORE_GATEWAY_GENERATOR_INFO.id,
        name: 'my-gateway',
        rc: 'MyGateway',
        iac: 'terraform',
      } as never,
    });
    tree.write(
      MANIFEST_PATH,
      JSON.stringify(
        {
          name: '@proj/my-gateway',
          dependencies: { express: 'catalog:' },
          devDependencies: { ejs: 'catalog:', '@types/ejs': 'catalog:' },
        },
        null,
        2,
      ),
    );
    if (options.script) {
      tree.write(SCRIPT_PATH, "const ejs = require('ejs');\n");
    }
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('declares ejs at the workspace root so the render script resolves it', async () => {
    addGateway({ script: true });

    await migration(tree);

    expect(rootEjs(tree)).toBeDefined();
  });

  it('declares the vended ejs version', async () => {
    addGateway({ script: true });

    await migration(tree);

    const declared = rootEjs(tree);
    expect(declared === 'catalog:' || declared === TS_VERSIONS.ejs).toBe(true);
  });

  // Purely additive: the migration cannot tell whether a user has started
  // importing ejs in the gateway project, so it never removes it.
  it('leaves the gateway project dependencies untouched', async () => {
    addGateway({ script: true });
    const before = JSON.parse(tree.read(MANIFEST_PATH, 'utf-8')!);

    await migration(tree);

    expect(JSON.parse(tree.read(MANIFEST_PATH, 'utf-8')!)).toEqual(before);
  });

  it('leaves a CDK gateway alone, which resolves ejs from shared constructs', async () => {
    addGateway();

    await migration(tree);

    expect(rootEjs(tree)).toBeUndefined();
  });

  it('is idempotent', async () => {
    addGateway({ script: true });

    await migration(tree);
    const afterFirst = {
      root: tree.read('package.json', 'utf-8'),
      manifest: tree.read(MANIFEST_PATH, 'utf-8'),
    };
    await migration(tree);

    expect(tree.read('package.json', 'utf-8')).toBe(afterFirst.root);
    expect(tree.read(MANIFEST_PATH, 'utf-8')).toBe(afterFirst.manifest);
  });
});
