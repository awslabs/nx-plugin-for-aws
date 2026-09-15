/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PACKAGE_JSON = 'packages/common/agent-connection/package.json';

const writeAgentConnection = (tree: Tree, dependencies: object) =>
  tree.write(
    PACKAGE_JSON,
    JSON.stringify({
      name: '@proj/agent-connection',
      version: '0.0.1',
      private: true,
      dependencies,
    }),
  );

describe('agent-connection-pin-strands-peers migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should declare @aws-sdk/client-s3 alongside a strands client', async () => {
    writeAgentConnection(tree, { '@strands-agents/sdk': '1.15.0' });

    await migration(tree);

    expect(
      readJson(tree, PACKAGE_JSON).dependencies['@aws-sdk/client-s3'],
    ).toBeDefined();
  });

  it('should leave a project without a strands client alone', async () => {
    writeAgentConnection(tree, { '@modelcontextprotocol/sdk': '1.25.2' });

    await migration(tree);

    expect(
      readJson(tree, PACKAGE_JSON).dependencies['@aws-sdk/client-s3'],
    ).toBeUndefined();
  });

  it('should keep an already-declared peer on the catalog', async () => {
    writeAgentConnection(tree, {
      '@strands-agents/sdk': '1.15.0',
      '@aws-sdk/client-s3': '3.1000.0',
    });

    await migration(tree);

    // A workspace with catalogs enabled records the version centrally, which is
    // the point: a range left in the manifest resolves to a second copy.
    expect(
      readJson(tree, PACKAGE_JSON).dependencies['@aws-sdk/client-s3'],
    ).toBe('catalog:');
  });

  it('should do nothing when the workspace has no agent-connection project', async () => {
    await expect(migration(tree)).resolves.not.toThrow();
    expect(tree.exists(PACKAGE_JSON)).toBe(false);
  });
});
