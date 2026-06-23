/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../test';
import {
  addPythonCoreClient,
  addTypeScriptCoreClient,
  ensurePythonAgentConnectionProject,
  ensureTypeScriptAgentConnectionProject,
  frameworkProtocols,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionProjectDir,
  SUPPORTED_AGENT_FRAMEWORKS,
} from './agent-connection';

/**
 * Behavioural backstop for the framework registry: it proves a `FRAMEWORKS`
 * entry is real, not a hollow stub. For every framework × every protocol it
 * claims to support, generating the connection client must emit framework code
 * into the shared agent-connection project. This means the framework guard
 * (framework-support.spec.ts) can't be satisfied by registering a framework
 * whose templates don't actually exist.
 *
 * It also pins the threading: an unknown framework (one not in the registry,
 * the state right after a contributor adds a schema enum value but forgets to
 * wire connections) must throw a clear not-supported error rather than silently
 * falling back to another framework's client.
 */

const countFiles = (tree: Tree, dir: string): number => {
  if (!tree.exists(dir)) return 0;
  return tree
    .children(dir)
    .reduce(
      (total, child) =>
        total +
        (tree.isFile(`${dir}/${child}`) ? 1 : countFiles(tree, `${dir}/${child}`)),
      0,
    );
};

describe('agent framework connection clients', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('every registered framework vends real client code', () => {
    for (const framework of SUPPORTED_AGENT_FRAMEWORKS) {
      for (const protocol of frameworkProtocols(framework, 'py')) {
        it(`py: ${framework} emits a ${protocol} client`, async () => {
          await ensurePythonAgentConnectionProject(tree);
          const coreDir = `${getPythonAgentConnectionProjectDir(tree)}/${getPythonAgentConnectionModuleName(tree)}/core`;
          const before = countFiles(tree, coreDir);

          await addPythonCoreClient(tree, protocol, framework);

          expect(countFiles(tree, coreDir)).toBeGreaterThan(before);
        });
      }

      for (const protocol of frameworkProtocols(framework, 'ts')) {
        it(`ts: ${framework} emits a ${protocol} client`, async () => {
          await ensureTypeScriptAgentConnectionProject(tree);
          const coreDir = 'packages/common/agent-connection/src/core';
          const before = countFiles(tree, coreDir);

          await addTypeScriptCoreClient(tree, protocol, framework);

          expect(countFiles(tree, coreDir)).toBeGreaterThan(before);
        });
      }
    }
  });

  describe('an unknown framework throws a clear not-supported error', () => {
    it('py: rejects with a not-supported message', async () => {
      await ensurePythonAgentConnectionProject(tree);
      await expect(
        addPythonCoreClient(tree, 'mcp', 'definitely-not-a-framework'),
      ).rejects.toThrow(/does not support Python agents/);
    });

    it('ts: rejects with a not-supported message', async () => {
      await ensureTypeScriptAgentConnectionProject(tree);
      await expect(
        addTypeScriptCoreClient(tree, 'mcp', 'definitely-not-a-framework'),
      ).rejects.toThrow(/does not support TypeScript agents/);
    });
  });
});
