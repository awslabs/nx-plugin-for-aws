/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRequire } from 'node:module';
import * as devkit from '@nx/devkit';
import {
  addProjectConfiguration,
  type ProjectGraph,
  readJson,
  type Tree,
} from '@nx/devkit';
import { afterEach, vi } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { tsSyncGeneratorGenerator } from './generator';

vi.mock('@nx/devkit', async (importOriginal) => {
  const original = await importOriginal<typeof devkit>();
  const { createRequire: createRequireInMock } = await import('node:module');
  const nxProjectGraph = createRequireInMock(import.meta.url)(
    'nx/src/project-graph/project-graph',
  );
  return {
    ...original,
    detectPackageManager: vi.fn(original.detectPackageManager),
    getPackageManagerVersion: vi.fn(original.getPackageManagerVersion),
    // Spreading `original` snapshots devkit's re-export, which would bypass
    // the per-test patch of the underlying nx module — delegate at call time.
    createProjectGraphAsync: (...args: unknown[]) =>
      nxProjectGraph.createProjectGraphAsync(...args),
  };
});

// The generator derives local dependencies from the Nx project graph (via
// createProjectGraphAsync). Building a real graph reads from disk, so patch the
// underlying nx module (the same technique as utils/mock-project-graph.ts) and
// set the graph per test.
const _require = createRequire(import.meta.url);
const projectGraphModule = _require('nx/src/project-graph/project-graph');
const originalCreateProjectGraphAsync =
  projectGraphModule.createProjectGraphAsync;

const setProjectGraph = (graph: ProjectGraph) => {
  projectGraphModule.createProjectGraphAsync = async () => graph;
};

const emptyGraph = (): ProjectGraph => ({ nodes: {}, dependencies: {} });

describe('ts-sync generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(devkit.detectPackageManager).mockReset();
    vi.mocked(devkit.getPackageManagerVersion).mockReset();
    // Default to an empty graph so the tsconfig-path sync tests don't build a
    // real (disk-backed) project graph. Tests that exercise local dependency
    // detection set their own graph.
    setProjectGraph(emptyGraph());
  });

  afterEach(() => {
    projectGraphModule.createProjectGraphAsync =
      originalCreateProjectGraphAsync;
  });

  const writeJson = (path: string, value: unknown) =>
    tree.write(path, JSON.stringify(value, null, 2));

  it('should add missing base paths to tsconfigs that define paths', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/index.ts'],
          '@shared/*': ['packages/shared/src/*'],
        },
      },
    });

    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });

    writeJson('packages/proj/tsconfig.json', {
      compilerOptions: {
        paths: {
          '@local/*': ['src/*'],
        },
      },
    });
    writeJson('packages/proj/tsconfig.lib.json', {
      compilerOptions: {
        paths: {
          '@local/*': ['src/*'],
        },
      },
    });
    writeJson('packages/proj/tsconfig.app.json', {
      compilerOptions: {
        module: 'esnext',
      },
    });

    const result = await tsSyncGeneratorGenerator(tree);

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.json')
        .compilerOptions.paths,
    ).toEqual({
      ':shared': ['../../packages/shared/src/index.ts'],
      '@shared/*': ['../../packages/shared/src/*'],
      '@local/*': ['src/*'],
    });
    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.lib.json')
        .compilerOptions.paths,
    ).toEqual({
      ':shared': ['../../packages/shared/src/index.ts'],
      '@shared/*': ['../../packages/shared/src/*'],
      '@local/*': ['src/*'],
    });
    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.app.json')
        .compilerOptions.paths,
    ).toBeUndefined();

    expect(result).toHaveProperty('outOfSyncMessage');
    expect((result as any).outOfSyncMessage).toContain(
      'packages/proj/tsconfig.json',
    );
    expect((result as any).outOfSyncMessage).toContain(':shared (added)');
    expect((result as any).outOfSyncMessage).toContain('@shared/* (added)');
  });

  it('should do nothing when tsconfig paths are not configured', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/index.ts'],
        },
      },
    });

    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });

    writeJson('packages/proj/tsconfig.json', {
      compilerOptions: {
        target: 'esnext',
      },
    });

    const result = await tsSyncGeneratorGenerator(tree);

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.json')
        .compilerOptions.paths,
    ).toBeUndefined();
    expect(result).toEqual({});
  });

  it('should leave project tsconfig unchanged when base paths already exist', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/index.ts'],
          '@shared/*': ['packages/shared/src/*'],
        },
      },
    });

    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });

    const projectTsConfig = {
      compilerOptions: {
        paths: {
          ':shared': ['../../packages/shared/src/index.ts'],
          '@shared/*': ['../../packages/shared/src/*'],
          '@local/*': ['src/*'],
        },
      },
    };

    writeJson('packages/proj/tsconfig.json', projectTsConfig);
    writeJson('packages/proj/tsconfig.lib.json', projectTsConfig);

    const result = await tsSyncGeneratorGenerator(tree);

    expect(readJson(tree, 'packages/proj/tsconfig.json')).toEqual(
      projectTsConfig,
    );
    expect(readJson(tree, 'packages/proj/tsconfig.lib.json')).toEqual(
      projectTsConfig,
    );
    expect(result).toEqual({});
  });

  it('should update existing paths when base config changes', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/main.ts'],
        },
      },
    });

    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });

    writeJson('packages/proj/tsconfig.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/old.ts'],
        },
      },
    });

    const result = await tsSyncGeneratorGenerator(tree);

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.json')
        .compilerOptions.paths,
    ).toEqual({
      ':shared': ['../../packages/shared/src/main.ts'],
    });
    expect(result).toHaveProperty('outOfSyncMessage');
    expect((result as any).outOfSyncMessage).toContain(':shared (updated)');
  });

  it('should ignore paths that are removed from the base config', async () => {
    writeJson('tsconfig.base.json', {
      compilerOptions: {
        paths: {},
      },
    });

    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });

    writeJson('packages/proj/tsconfig.json', {
      compilerOptions: {
        paths: {
          ':shared': ['packages/shared/src/index.ts'],
          '@local/*': ['src/*'],
        },
      },
    });

    const result = await tsSyncGeneratorGenerator(tree);

    expect(
      readJson<Record<string, any>>(tree, 'packages/proj/tsconfig.json')
        .compilerOptions.paths,
    ).toEqual({
      ':shared': ['packages/shared/src/index.ts'],
      '@local/*': ['src/*'],
    });
    expect(result).toEqual({});
  });

  it('should not format the tree (sync must have no formatting side effects)', async () => {
    // Writing files (formatting or otherwise) that the caller did not ask for
    // is a surprising side effect of `nx sync`, so the generator only syncs
    // path aliases. tsconfigs are excluded from the biome format target
    // instead, so their formatting does not need policing here.
    writeJson('tsconfig.base.json', { compilerOptions: { paths: {} } });
    addProjectConfiguration(tree, 'proj', {
      root: 'packages/proj',
      targets: {},
    });
    // No compilerOptions.paths to sync, and deliberately unformatted (expanded
    // array, no trailing newline).
    const unformatted =
      '{\n  "include": [\n    "src/**/*.ts",\n    "src/**/*.tsx"\n  ]\n}';
    tree.write('packages/proj/tsconfig.json', unformatted);

    const result = await tsSyncGeneratorGenerator(tree);

    expect(result).toEqual({});
    // Left exactly as written — the generator did not reformat it.
    expect(tree.read('packages/proj/tsconfig.json', 'utf-8')).toBe(unformatted);
  });

  describe('local project dependencies', () => {
    // Graph accumulated by addProject/addDependency for the test, then applied.
    let graph: ProjectGraph;

    beforeEach(() => {
      // A base tsconfig must exist for the generator to run its sync passes.
      writeJson('tsconfig.base.json', { compilerOptions: { paths: {} } });
      graph = emptyGraph();
    });

    const addProject = (name: string, pkgName: string) => {
      addProjectConfiguration(tree, name, {
        root: `packages/${name}`,
        sourceRoot: `packages/${name}/src`,
      });
      writeJson(`packages/${name}/package.json`, {
        name: pkgName,
        version: '0.0.0',
        private: true,
      });
      graph.nodes[name] = {
        name,
        type: 'lib',
        data: { root: `packages/${name}` },
      } as ProjectGraph['nodes'][string];
      graph.dependencies[name] = [];
    };

    // Register a source -> target project-graph edge, as Nx's file-import
    // analysis would produce from a cross-project import.
    const addDependency = (
      source: string,
      target: string,
      type: 'static' | 'dynamic' | 'implicit' = 'static',
    ) => {
      graph.dependencies[source].push({ source, target, type });
    };

    it('declares imported local projects as workspace:* dependencies', async () => {
      addProject('lib-a', '@proj/lib-a');
      addProject('lib-b', '@proj/lib-b');
      addDependency('lib-b', 'lib-a');
      setProjectGraph(graph);

      const result = await tsSyncGeneratorGenerator(tree);

      expect(result.outOfSyncMessage).toContain('@proj/lib-a: workspace:*');
      expect(
        readJson(tree, 'packages/lib-b/package.json').dependencies[
          '@proj/lib-a'
        ],
      ).toBe('workspace:*');
      // The imported project doesn't gain a dependency on its consumer.
      expect(
        readJson(tree, 'packages/lib-a/package.json').dependencies ?? {},
      ).not.toHaveProperty('@proj/lib-b');
    });

    it('maps the graph node to the target package.json name', async () => {
      // Project (graph node) name and package.json name deliberately differ.
      addProject('lib-a', '@proj/renamed-a');
      addProject('lib-b', '@proj/lib-b');
      addDependency('lib-b', 'lib-a');
      setProjectGraph(graph);

      await tsSyncGeneratorGenerator(tree);

      expect(
        readJson(tree, 'packages/lib-b/package.json').dependencies[
          '@proj/renamed-a'
        ],
      ).toBe('workspace:*');
    });

    it('ignores implicit dependencies', async () => {
      addProject('lib-a', '@proj/lib-a');
      addProject('lib-b', '@proj/lib-b');
      addDependency('lib-b', 'lib-a', 'implicit');
      setProjectGraph(graph);

      const result = await tsSyncGeneratorGenerator(tree);

      expect(result).toEqual({});
      expect(
        readJson(tree, 'packages/lib-b/package.json').dependencies ?? {},
      ).not.toHaveProperty('@proj/lib-a');
    });

    it('is idempotent and does not touch an already-declared dependency', async () => {
      addProject('lib-a', '@proj/lib-a');
      addProject('lib-b', '@proj/lib-b');
      addDependency('lib-b', 'lib-a');
      setProjectGraph(graph);

      await tsSyncGeneratorGenerator(tree);
      const afterFirst = tree.read('packages/lib-b/package.json', 'utf-8');
      const result = await tsSyncGeneratorGenerator(tree);

      expect(result).toEqual({});
      expect(tree.read('packages/lib-b/package.json', 'utf-8')).toBe(
        afterFirst,
      );
    });

    // npm and yarn classic reject the `workspace:` protocol (npm fails the
    // install with EUNSUPPORTEDPROTOCOL; yarn classic tries the registry), so
    // the sync writes `*` for them instead.
    it.each([
      ['npm', '11.0.0'],
      ['yarn', '1.22.22'],
    ])('declares local projects with * on %s (no workspace protocol support)', async (packageManager, version) => {
      tree.delete('pnpm-workspace.yaml');
      vi.mocked(devkit.detectPackageManager).mockReturnValue(
        packageManager as devkit.PackageManager,
      );
      vi.mocked(devkit.getPackageManagerVersion).mockReturnValue(version);
      addProject('lib-a', '@proj/lib-a');
      addProject('lib-b', '@proj/lib-b');
      addDependency('lib-b', 'lib-a');
      setProjectGraph(graph);

      const result = await tsSyncGeneratorGenerator(tree);

      expect(result.outOfSyncMessage).toContain('@proj/lib-a: *');
      expect(
        readJson(tree, 'packages/lib-b/package.json').dependencies[
          '@proj/lib-a'
        ],
      ).toBe('*');
    });

    it('declares local projects with workspace:* on yarn berry', async () => {
      tree.delete('pnpm-workspace.yaml');
      vi.mocked(devkit.detectPackageManager).mockReturnValue('yarn');
      vi.mocked(devkit.getPackageManagerVersion).mockReturnValue('4.10.0');
      addProject('lib-a', '@proj/lib-a');
      addProject('lib-b', '@proj/lib-b');
      addDependency('lib-b', 'lib-a');
      setProjectGraph(graph);

      await tsSyncGeneratorGenerator(tree);

      expect(
        readJson(tree, 'packages/lib-b/package.json').dependencies[
          '@proj/lib-a'
        ],
      ).toBe('workspace:*');
    });

    it('does not add a workspace dependency for a project that is not imported', async () => {
      addProject('lib-a', '@proj/lib-a');
      addProject('lib-b', '@proj/lib-b');
      setProjectGraph(graph);

      const result = await tsSyncGeneratorGenerator(tree);

      expect(result).toEqual({});
      expect(
        readJson(tree, 'packages/lib-b/package.json').dependencies ?? {},
      ).not.toHaveProperty('@proj/lib-a');
    });
  });
});
