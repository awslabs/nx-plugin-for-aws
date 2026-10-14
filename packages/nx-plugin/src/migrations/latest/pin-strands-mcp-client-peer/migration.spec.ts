/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { tsAgentGenerator } from '../../../ts/agent/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const MCP_CLIENT = '@modelcontextprotocol/client';
const AGENT_CONNECTION_PACKAGE_JSON =
  'packages/common/agent-connection/package.json';
const ROOT_PACKAGE_JSON = 'package.json';

const writeAgentConnection = (tree: Tree, dependencies: object) =>
  writeJson(tree, AGENT_CONNECTION_PACKAGE_JSON, {
    name: '@proj/agent-connection',
    version: '0.0.1',
    private: true,
    dependencies,
  });

const addRootDependencies = (tree: Tree, dependencies: object) => {
  const root = readJson(tree, ROOT_PACKAGE_JSON);
  writeJson(tree, ROOT_PACKAGE_JSON, {
    ...root,
    dependencies: { ...root.dependencies, ...dependencies },
  });
};

const addProjectWithPackageJson = (
  tree: Tree,
  root: string,
  dependencies: object,
) => {
  addProjectConfiguration(tree, root.replace(/\//g, '-'), {
    root,
    projectType: 'application',
  });
  writeJson(tree, `${root}/package.json`, {
    name: `@proj/${root}`,
    version: '0.0.0',
    private: true,
    dependencies,
  });
};

const dependenciesOf = (tree: Tree, path: string) =>
  readJson(tree, path).dependencies ?? {};

describe('pin-strands-mcp-client-peer migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should converge a ts#agent project on what the generator writes today', async () => {
    addProjectConfiguration(tree, 'my-agent', {
      root: 'apps/my-agent',
      sourceRoot: 'apps/my-agent/src',
      targets: {},
    });
    writeJson(tree, 'apps/my-agent/tsconfig.json', {});
    writeJson(tree, 'apps/my-agent/package.json', {
      name: 'my-agent',
      version: '0.0.0',
    });
    await tsAgentGenerator(tree, {
      project: 'my-agent',
      name: 'agent',
      infra: 'none',
      iac: 'cdk',
    });
    const generated = tree.read('apps/my-agent/package.json', 'utf-8');
    expect(dependenciesOf(tree, 'apps/my-agent/package.json')).toHaveProperty(
      MCP_CLIENT,
    );

    // The shape a workspace generated before the client was declared has.
    const { [MCP_CLIENT]: _, ...withoutClient } = dependenciesOf(
      tree,
      'apps/my-agent/package.json',
    );
    writeJson(tree, 'apps/my-agent/package.json', {
      ...readJson(tree, 'apps/my-agent/package.json'),
      dependencies: withoutClient,
    });

    await migration(tree);

    expect(dependenciesOf(tree, 'apps/my-agent/package.json')[MCP_CLIENT]).toBe(
      'catalog:',
    );
    expect(
      Object.keys(dependenciesOf(tree, 'apps/my-agent/package.json')).sort(),
    ).toEqual(Object.keys(JSON.parse(generated ?? '{}').dependencies).sort());
  });

  it('should declare the client on the agent-connection project', async () => {
    writeAgentConnection(tree, { '@strands-agents/sdk': '1.19.0' });

    await migration(tree);

    expect(
      dependenciesOf(tree, AGENT_CONNECTION_PACKAGE_JSON)[MCP_CLIENT],
    ).toBe('catalog:');
  });

  it('should declare the client on the workspace root when it declares strands', async () => {
    addRootDependencies(tree, { '@strands-agents/sdk': '1.19.0' });

    await migration(tree);

    expect(dependenciesOf(tree, ROOT_PACKAGE_JSON)[MCP_CLIENT]).toBe(
      'catalog:',
    );
  });

  it('should declare the client on any other project declaring strands', async () => {
    addProjectWithPackageJson(tree, 'docs', {
      '@strands-agents/sdk': '1.19.0',
      astro: '5.0.0',
    });

    await migration(tree);

    expect(dependenciesOf(tree, 'docs/package.json')[MCP_CLIENT]).toBe(
      'catalog:',
    );
  });

  it('should leave manifests without a strands client alone', async () => {
    addProjectWithPackageJson(tree, 'apps/other', { astro: '5.0.0' });
    writeAgentConnection(tree, { '@modelcontextprotocol/sdk': '1.25.2' });
    const before = {
      other: tree.read('apps/other/package.json', 'utf-8'),
      root: tree.read(ROOT_PACKAGE_JSON, 'utf-8'),
    };

    await migration(tree);

    expect(dependenciesOf(tree, 'apps/other/package.json')).not.toHaveProperty(
      MCP_CLIENT,
    );
    expect(
      dependenciesOf(tree, AGENT_CONNECTION_PACKAGE_JSON),
    ).not.toHaveProperty(MCP_CLIENT);
    expect(dependenciesOf(tree, ROOT_PACKAGE_JSON)).not.toHaveProperty(
      MCP_CLIENT,
    );
    expect(tree.read(ROOT_PACKAGE_JSON, 'utf-8')).toBe(before.root);
  });

  it('should move an already-declared client onto the catalog', async () => {
    addProjectWithPackageJson(tree, 'apps/http-agent', {
      '@strands-agents/sdk': '1.19.0',
      [MCP_CLIENT]: '^2.0.0',
    });

    await migration(tree);

    expect(
      dependenciesOf(tree, 'apps/http-agent/package.json')[MCP_CLIENT],
    ).toBe('catalog:');
  });

  it('should be idempotent', async () => {
    writeAgentConnection(tree, { '@strands-agents/sdk': '1.19.0' });
    addRootDependencies(tree, { '@strands-agents/sdk': '1.19.0' });
    addProjectWithPackageJson(tree, 'apps/http-agent', {
      '@strands-agents/sdk': '1.19.0',
    });

    await migration(tree);
    const snapshot = () =>
      [
        AGENT_CONNECTION_PACKAGE_JSON,
        ROOT_PACKAGE_JSON,
        'apps/http-agent/package.json',
        'pnpm-workspace.yaml',
      ].map((path) => tree.read(path, 'utf-8'));
    const afterFirstRun = snapshot();

    await migration(tree);

    expect(snapshot()).toEqual(afterFirstRun);
  });
});
