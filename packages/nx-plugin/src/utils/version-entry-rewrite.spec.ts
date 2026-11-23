/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyGritQL } from './ast.js';
import { versionEntryRewrite } from './version-entry-rewrite.js';

/**
 * The declaration forms `versions.ts` uses, including the two runtime constants
 * that share a `python` key with the same value — the pair an unscoped rewrite
 * moved together.
 */
const VERSIONS_FILE = `export const TS_VERSIONS = {
  '@a2a-js/sdk': '0.3.14',
  minimatch: '11.0.8',
} as const;

export const LAMBDA_RUNTIME_VERSIONS = {
  node: '24',
  python: '3.14',
} as const;

export const AGENT_CORE_RUNTIME_VERSIONS = {
  node: '22',
  python: '3.14',
} as const;
`;

describe('version entry rewrite', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    tree.write('versions.ts', VERSIONS_FILE);
  });

  const rewrite = async (pattern: string): Promise<string> => {
    await applyGritQL(tree, 'versions.ts', pattern);
    return tree.read('versions.ts', 'utf-8')!;
  };

  // The defect this scoping exists for: AgentCore Runtime has no Python 3.15,
  // so moving its pin alongside Lambda's writes a runtime that does not exist.
  it('should leave a shared key in another constant alone', async () => {
    const updated = await rewrite(
      versionEntryRewrite({
        constantName: 'LAMBDA_RUNTIME_VERSIONS',
        name: 'python',
        oldVersion: '3.14',
        newVersion: '3.15',
      }),
    );

    expect(updated).toContain("node: '24',\n  python: '3.15',");
    expect(updated).toContain("node: '22',\n  python: '3.14',");
  });

  it('should move the entry of the constant it names', async () => {
    const updated = await rewrite(
      versionEntryRewrite({
        constantName: 'AGENT_CORE_RUNTIME_VERSIONS',
        name: 'python',
        oldVersion: '3.14',
        newVersion: '3.15',
      }),
    );

    expect(updated).toContain("node: '22',\n  python: '3.15',");
    expect(updated).toContain("node: '24',\n  python: '3.14',");
  });

  it('should quote a key that is not a valid identifier', async () => {
    const updated = await rewrite(
      versionEntryRewrite({
        constantName: 'TS_VERSIONS',
        name: '@a2a-js/sdk',
        oldVersion: '0.3.14',
        newVersion: '0.4.0',
      }),
    );

    expect(updated).toContain("'@a2a-js/sdk': '0.4.0'");
  });

  it('should move a bare identifier key', async () => {
    const updated = await rewrite(
      versionEntryRewrite({
        constantName: 'TS_VERSIONS',
        name: 'minimatch',
        oldVersion: '11.0.8',
        newVersion: '11.0.9',
      }),
    );

    expect(updated).toContain("minimatch: '11.0.9'");
  });

  // A constant the file does not hold must change nothing, so a rename shows up
  // as a version that stopped moving rather than as an edit somewhere else.
  it('should change nothing when the constant is not in the file', async () => {
    const updated = await rewrite(
      versionEntryRewrite({
        constantName: 'NOT_A_CONSTANT',
        name: 'python',
        oldVersion: '3.14',
        newVersion: '3.15',
      }),
    );

    expect(updated).toBe(VERSIONS_FILE);
  });
});
