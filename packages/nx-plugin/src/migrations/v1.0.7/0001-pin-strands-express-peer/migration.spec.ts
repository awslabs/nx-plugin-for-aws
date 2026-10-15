/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const AGENT_CONNECTION_ROOT = 'packages/common/agent-connection';
const AGENT_CONNECTION_PACKAGE_JSON = `${AGENT_CONNECTION_ROOT}/package.json`;
const ROOT_PACKAGE_JSON = 'package.json';

const writeAgentConnection = (tree: Tree, dependencies: object) =>
  tree.write(
    AGENT_CONNECTION_PACKAGE_JSON,
    JSON.stringify({
      name: '@proj/agent-connection',
      version: '0.0.1',
      private: true,
      dependencies,
    }),
  );

const addRootDependencies = (tree: Tree, dependencies: object) => {
  const root = readJson(tree, ROOT_PACKAGE_JSON);
  tree.write(
    ROOT_PACKAGE_JSON,
    JSON.stringify({
      ...root,
      dependencies: { ...root.dependencies, ...dependencies },
    }),
  );
};

/** Register an arbitrary project with its own package.json — the shape any
 * strands importer takes (e.g. ts#agent's http protocol, ts#astro-docs). */
const addProjectWithPackageJson = (
  tree: Tree,
  root: string,
  dependencies: object,
) => {
  addProjectConfiguration(tree, root.replace(/\//g, '-'), {
    root,
    projectType: 'application',
  });
  tree.write(
    `${root}/package.json`,
    JSON.stringify({
      name: `@proj/${root}`,
      version: '0.0.0',
      private: true,
      dependencies,
    }),
  );
};

describe('pin-strands-express-peer migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('agent-connection project', () => {
    it('should declare express alongside a strands client', async () => {
      writeAgentConnection(tree, { '@strands-agents/sdk': '1.19.0' });

      await migration(tree);

      expect(
        readJson(tree, AGENT_CONNECTION_PACKAGE_JSON).dependencies.express,
      ).toBeDefined();
    });

    it('should leave a project without a strands client alone', async () => {
      writeAgentConnection(tree, { '@modelcontextprotocol/sdk': '1.25.2' });

      await migration(tree);

      expect(
        readJson(tree, AGENT_CONNECTION_PACKAGE_JSON).dependencies.express,
      ).toBeUndefined();
    });

    it('should keep an already-declared peer on the catalog', async () => {
      writeAgentConnection(tree, {
        '@strands-agents/sdk': '1.19.0',
        express: '5.2.1',
      });

      await migration(tree);

      // A workspace with catalogs enabled records the version centrally,
      // which is the point: a range left in the manifest resolves to a
      // second copy.
      expect(
        readJson(tree, AGENT_CONNECTION_PACKAGE_JSON).dependencies.express,
      ).toBe('catalog:');
    });

    it('should do nothing when the project does not exist', async () => {
      await expect(migration(tree)).resolves.not.toThrow();
      expect(tree.exists(AGENT_CONNECTION_PACKAGE_JSON)).toBe(false);
    });
  });

  describe('workspace root', () => {
    it('should declare express when the root declares strands', async () => {
      addRootDependencies(tree, { '@strands-agents/sdk': '1.19.0' });

      await migration(tree);

      expect(
        readJson(tree, ROOT_PACKAGE_JSON).dependencies.express,
      ).toBeDefined();
    });

    it('should leave the root alone when it has no strands dependency', async () => {
      await migration(tree);

      expect(
        readJson(tree, ROOT_PACKAGE_JSON).dependencies?.express,
      ).toBeUndefined();
    });

    it('should keep an already-declared root peer on the catalog', async () => {
      addRootDependencies(tree, {
        '@strands-agents/sdk': '1.19.0',
        express: '5.2.1',
      });

      await migration(tree);

      expect(readJson(tree, ROOT_PACKAGE_JSON).dependencies.express).toBe(
        'catalog:',
      );
    });
  });

  describe('any other project (generic detection, not keyed by generator)', () => {
    it('should declare express on a project declaring strands without it (e.g. ts#agent http protocol)', async () => {
      addProjectWithPackageJson(tree, 'apps/http-agent', {
        '@strands-agents/sdk': '1.19.0',
        '@trpc/server': '11.0.0',
      });

      await migration(tree);

      expect(
        readJson(tree, 'apps/http-agent/package.json').dependencies.express,
      ).toBeDefined();
    });

    it('should declare express on a project declaring strands without it (e.g. ts#astro-docs translation)', async () => {
      addProjectWithPackageJson(tree, 'docs', {
        '@strands-agents/sdk': '1.19.0',
        astro: '5.0.0',
      });

      await migration(tree);

      expect(
        readJson(tree, 'docs/package.json').dependencies.express,
      ).toBeDefined();
    });

    it('should leave a project without a strands client alone', async () => {
      addProjectWithPackageJson(tree, 'apps/other', {
        astro: '5.0.0',
      });

      await migration(tree);

      expect(
        readJson(tree, 'apps/other/package.json').dependencies?.express,
      ).toBeUndefined();
    });

    it('should keep an already-declared peer on the catalog', async () => {
      addProjectWithPackageJson(tree, 'apps/http-agent', {
        '@strands-agents/sdk': '1.19.0',
        express: '5.3.0',
      });

      await migration(tree);

      expect(
        readJson(tree, 'apps/http-agent/package.json').dependencies.express,
      ).toBe('catalog:');
    });
  });

  it('should do nothing when there is no agent-connection project and no root strands dependency', async () => {
    await expect(migration(tree)).resolves.not.toThrow();
    expect(tree.exists(AGENT_CONNECTION_PACKAGE_JSON)).toBe(false);
    expect(
      readJson(tree, ROOT_PACKAGE_JSON).dependencies?.express,
    ).toBeUndefined();
  });

  it('should be idempotent — a second run makes no further changes', async () => {
    writeAgentConnection(tree, { '@strands-agents/sdk': '1.19.0' });
    addRootDependencies(tree, { '@strands-agents/sdk': '1.19.0' });
    addProjectWithPackageJson(tree, 'apps/http-agent', {
      '@strands-agents/sdk': '1.19.0',
    });
    addProjectWithPackageJson(tree, 'docs', {
      '@strands-agents/sdk': '1.19.0',
    });

    await migration(tree);
    const afterFirstRun = {
      agentConnection: tree.read(AGENT_CONNECTION_PACKAGE_JSON, 'utf-8'),
      root: tree.read(ROOT_PACKAGE_JSON, 'utf-8'),
      httpAgent: tree.read('apps/http-agent/package.json', 'utf-8'),
      docs: tree.read('docs/package.json', 'utf-8'),
    };

    await migration(tree);
    const afterSecondRun = {
      agentConnection: tree.read(AGENT_CONNECTION_PACKAGE_JSON, 'utf-8'),
      root: tree.read(ROOT_PACKAGE_JSON, 'utf-8'),
      httpAgent: tree.read('apps/http-agent/package.json', 'utf-8'),
      docs: tree.read('docs/package.json', 'utf-8'),
    };

    expect(afterSecondRun).toEqual(afterFirstRun);
  });
});
