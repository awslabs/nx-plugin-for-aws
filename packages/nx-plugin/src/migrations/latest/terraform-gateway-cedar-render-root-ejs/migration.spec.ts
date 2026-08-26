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

  const addGateway = (
    options: { script?: boolean; manifest?: Record<string, unknown> } = {},
  ) => {
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
        options.manifest ?? {
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

    // The root manifest is the nearest one above the script, which sits in the
    // package.json-less shared terraform project.
    expect(rootEjs(tree)).toBeDefined();
  });

  it('drops the redundant ejs from the gateway manifest', async () => {
    addGateway({ script: true });

    await migration(tree);

    const manifest = JSON.parse(tree.read(MANIFEST_PATH, 'utf-8')!);
    expect(manifest.devDependencies).not.toHaveProperty('ejs');
    expect(manifest.devDependencies).not.toHaveProperty('@types/ejs');
    expect(manifest.dependencies).toEqual({ express: 'catalog:' });
  });

  it('keeps an ejs version the user pinned themselves', async () => {
    addGateway({
      script: true,
      manifest: {
        name: '@proj/my-gateway',
        devDependencies: { ejs: '^3.1.0' },
      },
    });

    await migration(tree);

    expect(
      JSON.parse(tree.read(MANIFEST_PATH, 'utf-8')!).devDependencies.ejs,
    ).toBe('^3.1.0');
  });

  it('leaves a CDK gateway alone, which resolves ejs from shared constructs', async () => {
    addGateway();

    await migration(tree);

    expect(rootEjs(tree)).toBeUndefined();
    // The CDK gateway's own manifest is not touched either.
    expect(
      JSON.parse(tree.read(MANIFEST_PATH, 'utf-8')!).devDependencies.ejs,
    ).toBe('catalog:');
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

  it('declares the vended ejs version', async () => {
    addGateway({ script: true });

    await migration(tree);

    // Either the pinned range or a catalog reference resolving to it.
    const declared = rootEjs(tree);
    expect(declared === 'catalog:' || declared === TS_VERSIONS.ejs).toBe(true);
  });
});
