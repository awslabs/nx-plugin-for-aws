/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateJson } from '@nx/devkit';
import {
  connectionGenerator,
  determineProjectType,
  findComponentInMetadata,
  resolveConnection,
  Connection,
  PROJECT_COMPONENT_SENTINEL,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { vi, expect, describe, it, beforeEach } from 'vitest';
import trpcReactGenerator from '../trpc/react/generator';
import fastApiReactGenerator from '../py/fast-api/react/generator';
import smithyReactConnectionGenerator from '../smithy/react-connection/generator';

// Mock the generators
vi.mock('../trpc/react/generator', () => ({
  default: vi.fn(),
}));

vi.mock('../py/fast-api/react/generator', () => ({
  default: vi.fn(),
}));

vi.mock('../smithy/react-connection/generator', () => ({
  default: vi.fn(),
}));

describe('connection generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.clearAllMocks();
  });

  // Helper to set up a React project
  const setupReactProject = (name = 'frontend', components?: any[]) => {
    tree.write(`apps/${name}/src/main.tsx`, '');
    tree.write(
      `apps/${name}/project.json`,
      JSON.stringify({
        name,
        root: `apps/${name}`,
        ...(components ? { metadata: { components } } : {}),
      }),
    );
  };

  // Helper to set up a tRPC API project
  const setupTrpcProject = (name = 'api', components?: any[]) => {
    tree.write(
      `apps/${name}/project.json`,
      JSON.stringify({
        name,
        root: `apps/${name}`,
        metadata: {
          apiType: 'trpc',
          ...(components ? { components } : {}),
        },
      }),
    );
  };

  // Helper to set up a FastAPI project
  const setupFastApiProject = (name = 'api') => {
    tree.write(
      `apps/${name}/project.json`,
      JSON.stringify({
        name,
        root: `apps/${name}`,
        metadata: { apiType: 'fast-api' },
      }),
    );
  };

  // Helper to set up a Smithy project
  const setupSmithyProject = (name = 'api-model') => {
    tree.write(
      `apps/${name}/project.json`,
      JSON.stringify({
        name,
        root: `apps/${name}`,
        metadata: { generator: 'smithy#project' },
      }),
    );
  };

  // Helper to set up an unknown project
  const setupUnknownProject = (name = 'unknown', components?: any[]) => {
    tree.write(
      `apps/${name}/project.json`,
      JSON.stringify({
        name,
        root: `apps/${name}`,
        ...(components ? { metadata: { components } } : {}),
      }),
    );
  };

  describe('findComponentInMetadata', () => {
    it('should find component by name', () => {
      const config = {
        name: 'p',
        root: 'p',
        metadata: { components: [{ generator: 'g', path: 'p', name: 'n' }] },
      } as any;
      expect(findComponentInMetadata(config, 'n')).toEqual({
        generator: 'g',
        path: 'p',
        name: 'n',
      });
    });

    it('should find component by path', () => {
      const config = {
        name: 'p',
        root: 'p',
        metadata: {
          components: [{ generator: 'g', path: 'src/handler.ts', name: 'n' }],
        },
      } as any;
      expect(findComponentInMetadata(config, 'src/handler.ts')).toEqual({
        generator: 'g',
        path: 'src/handler.ts',
        name: 'n',
      });
    });

    it('should find component by generator', () => {
      const config = {
        name: 'p',
        root: 'p',
        metadata: {
          components: [{ generator: 'ts#lambda', path: 'p', name: 'n' }],
        },
      } as any;
      expect(findComponentInMetadata(config, 'ts#lambda')).toEqual({
        generator: 'ts#lambda',
        path: 'p',
        name: 'n',
      });
    });

    it('should return undefined when not found', () => {
      const config = {
        name: 'p',
        root: 'p',
        metadata: { components: [{ generator: 'g', path: 'p', name: 'n' }] },
      } as any;
      expect(findComponentInMetadata(config, 'missing')).toBeUndefined();
    });

    it('should return undefined when no components', () => {
      expect(
        findComponentInMetadata({ name: 'p', root: 'p' } as any, 'x'),
      ).toBeUndefined();
    });

    it('should prioritize name over path', () => {
      const config = {
        name: 'p',
        root: 'p',
        metadata: {
          components: [
            { generator: 'a', path: 'shared', name: 'comp-a' },
            { generator: 'b', path: 'other', name: 'shared' },
          ],
        },
      } as any;
      const result = findComponentInMetadata(config, 'shared');
      expect(result?.generator).toBe('b'); // matched by name
    });

    it('should prioritize path over generator', () => {
      const config = {
        name: 'p',
        root: 'p',
        metadata: {
          components: [
            { generator: 'shared', path: 'path-a', name: 'a' },
            { generator: 'b', path: 'shared', name: 'b' },
          ],
        },
      } as any;
      const result = findComponentInMetadata(config, 'shared');
      expect(result?.generator).toBe('b'); // matched by path
    });
  });

  describe('resolveConnection', () => {
    describe('project-level connections (no components)', () => {
      it('should resolve react -> trpc', () => {
        setupReactProject();
        setupTrpcProject();
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
        });
        expect(result.connection).toEqual({
          source: 'react',
          target: 'ts#trpc-api',
        });
        expect(result.sourceComponent).toBeUndefined();
        expect(result.targetComponent).toBeUndefined();
      });

      it('should resolve react -> fast-api', () => {
        setupReactProject();
        setupFastApiProject();
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
        });
        expect(result.connection).toEqual({
          source: 'react',
          target: 'py#fast-api',
        });
      });

      it('should resolve react -> smithy', () => {
        setupReactProject();
        setupSmithyProject();
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api-model',
        });
        expect(result.connection).toEqual({
          source: 'react',
          target: 'smithy',
        });
      });

      it('should throw for unsupported connection (trpc -> trpc)', () => {
        setupTrpcProject('api1');
        setupTrpcProject('api2');
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'api1',
            targetProject: 'api2',
          }),
        ).toThrow(/does not support a connection from api1.*to api2/);
      });

      it('should throw for unknown source', () => {
        setupUnknownProject();
        setupTrpcProject();
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'unknown',
            targetProject: 'api',
          }),
        ).toThrow(/does not support a connection from unknown.*to api/);
      });

      it('should throw for unknown target', () => {
        setupReactProject();
        setupUnknownProject();
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'unknown',
          }),
        ).toThrow(/does not support a connection from frontend.*to unknown/);
      });

      it('should throw for both unknown', () => {
        setupUnknownProject('u1');
        setupUnknownProject('u2');
        expect(() =>
          resolveConnection(tree, { sourceProject: 'u1', targetProject: 'u2' }),
        ).toThrow(/does not support a connection from u1.*to u2/);
      });
    });

    describe('with non-connection-participating components', () => {
      it('should resolve project-level connection when source has non-participating components', () => {
        setupReactProject('frontend', [
          {
            generator: 'ts#runtime-config',
            path: 'src/components/RuntimeConfig',
          },
          { generator: 'ts#cognito-auth', path: 'src/components/CognitoAuth' },
        ]);
        setupTrpcProject();
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
        });
        expect(result.connection).toEqual({
          source: 'react',
          target: 'ts#trpc-api',
        });
        expect(result.sourceComponent).toBeUndefined();
      });

      it('should resolve project-level connection when target has non-participating components', () => {
        setupReactProject();
        setupTrpcProject('api', [
          {
            generator: 'ts#lambda-function',
            path: 'src/handler.ts',
            name: 'handler',
          },
        ]);
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
        });
        expect(result.connection).toEqual({
          source: 'react',
          target: 'ts#trpc-api',
        });
        expect(result.targetComponent).toBeUndefined();
      });

      it('should resolve when both sides have non-participating components', () => {
        setupReactProject('frontend', [
          { generator: 'ts#runtime-config', path: 'src/rc' },
        ]);
        setupTrpcProject('api', [
          { generator: 'ts#lambda-function', path: 'src/h.ts', name: 'h' },
        ]);
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
        });
        expect(result.connection).toEqual({
          source: 'react',
          target: 'ts#trpc-api',
        });
      });
    });

    describe('with component-level connections (custom supported connections)', () => {
      const customConnections: Connection[] = [
        { source: 'react', target: 'ts#trpc-api' },
        { source: 'comp-src', target: 'comp-tgt' },
      ];

      it('should resolve component-level connection', () => {
        setupUnknownProject('src', [
          { generator: 'comp-src', path: 'src/c', name: 'cs' },
        ]);
        setupUnknownProject('tgt', [
          { generator: 'comp-tgt', path: 'src/c', name: 'ct' },
        ]);
        const result = resolveConnection(
          tree,
          { sourceProject: 'src', targetProject: 'tgt' },
          customConnections,
        );
        expect(result.connection).toEqual({
          source: 'comp-src',
          target: 'comp-tgt',
        });
        expect(result.sourceComponent).toEqual({
          generator: 'comp-src',
          path: 'src/c',
          name: 'cs',
        });
        expect(result.targetComponent).toEqual({
          generator: 'comp-tgt',
          path: 'src/c',
          name: 'ct',
        });
      });

      it('should throw when multiple connections match (ambiguous)', () => {
        setupReactProject('src', [
          { generator: 'comp-src', path: 'src/c', name: 'cs' },
        ]);
        setupTrpcProject('tgt', [
          { generator: 'comp-tgt', path: 'src/c', name: 'ct' },
        ]);
        expect(() =>
          resolveConnection(
            tree,
            { sourceProject: 'src', targetProject: 'tgt' },
            customConnections,
          ),
        ).toThrow(/Ambiguous connection from src to tgt/);
      });

      it('should resolve when only one component connection matches among multiple components', () => {
        setupUnknownProject('src', [
          { generator: 'comp-src', path: 'src/c', name: 'cs' },
          { generator: 'other', path: 'src/o', name: 'other' },
        ]);
        setupUnknownProject('tgt', [
          { generator: 'comp-tgt', path: 'src/c', name: 'ct' },
        ]);
        const result = resolveConnection(
          tree,
          { sourceProject: 'src', targetProject: 'tgt' },
          customConnections,
        );
        expect(result.connection).toEqual({
          source: 'comp-src',
          target: 'comp-tgt',
        });
        expect(result.sourceComponent?.name).toBe('cs');
      });
    });

    describe('sourceComponent validation', () => {
      it('should throw when not found (no components)', () => {
        setupReactProject();
        setupTrpcProject();
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'x',
          }),
        ).toThrow(
          "Component 'x' not found in source project frontend. Available components: none",
        );
      });

      it('should throw with available components listed', () => {
        setupReactProject('frontend', [
          { generator: 'g1', path: 'p1', name: 'comp-a' },
          { generator: 'g2', path: 'p2', name: 'comp-b' },
        ]);
        setupTrpcProject();
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'x',
          }),
        ).toThrow(
          "Component 'x' not found in source project frontend. Available components: comp-a, comp-b",
        );
      });

      it('should succeed when found by name', () => {
        setupReactProject('frontend', [
          { generator: 'g', path: 'p', name: 'rc' },
        ]);
        setupTrpcProject();
        expect(
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'rc',
          }).connection,
        ).toEqual({ source: 'react', target: 'ts#trpc-api' });
      });

      it('should succeed when found by path', () => {
        setupReactProject('frontend', [{ generator: 'g', path: 'src/rc' }]);
        setupTrpcProject();
        expect(
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'src/rc',
          }).connection,
        ).toEqual({ source: 'react', target: 'ts#trpc-api' });
      });

      it('should succeed when found by generator', () => {
        setupReactProject('frontend', [{ generator: 'ts#rc', path: 'p' }]);
        setupTrpcProject();
        expect(
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'ts#rc',
          }).connection,
        ).toEqual({ source: 'react', target: 'ts#trpc-api' });
      });
    });

    describe('targetComponent validation', () => {
      it('should throw when not found (no components)', () => {
        setupReactProject();
        setupTrpcProject();
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            targetComponent: 'x',
          }),
        ).toThrow(
          "Component 'x' not found in target project api. Available components: none",
        );
      });

      it('should throw with available components listed', () => {
        setupReactProject();
        setupTrpcProject('api', [
          { generator: 'g', path: 'p', name: 'handler' },
        ]);
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            targetComponent: 'x',
          }),
        ).toThrow(
          "Component 'x' not found in target project api. Available components: handler",
        );
      });

      it('should succeed when found by name', () => {
        setupReactProject();
        setupTrpcProject('api', [{ generator: 'g', path: 'p', name: 'h' }]);
        expect(
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            targetComponent: 'h',
          }).connection,
        ).toEqual({ source: 'react', target: 'ts#trpc-api' });
      });

      it('should succeed when found by path', () => {
        setupReactProject();
        setupTrpcProject('api', [
          { generator: 'g', path: 'src/h.ts', name: 'h' },
        ]);
        expect(
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            targetComponent: 'src/h.ts',
          }).connection,
        ).toEqual({ source: 'react', target: 'ts#trpc-api' });
      });

      it('should succeed when found by generator', () => {
        setupReactProject();
        setupTrpcProject('api', [{ generator: 'ts#lf', path: 'p', name: 'h' }]);
        expect(
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            targetComponent: 'ts#lf',
          }).connection,
        ).toEqual({ source: 'react', target: 'ts#trpc-api' });
      });
    });

    describe('both sourceComponent and targetComponent', () => {
      it('should succeed when both found', () => {
        setupReactProject('frontend', [
          { generator: 'g1', path: 'p1', name: 'sc' },
        ]);
        setupTrpcProject('api', [{ generator: 'g2', path: 'p2', name: 'tc' }]);
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
          sourceComponent: 'sc',
          targetComponent: 'tc',
        });
        expect(result.connection).toEqual({
          source: 'react',
          target: 'ts#trpc-api',
        });
      });

      it('should throw when sourceComponent not found', () => {
        setupReactProject();
        setupTrpcProject('api', [{ generator: 'g', path: 'p', name: 'tc' }]);
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'missing',
            targetComponent: 'tc',
          }),
        ).toThrow(/Component 'missing' not found in source project/);
      });

      it('should throw when targetComponent not found', () => {
        setupReactProject('frontend', [
          { generator: 'g', path: 'p', name: 'sc' },
        ]);
        setupTrpcProject();
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'sc',
            targetComponent: 'missing',
          }),
        ).toThrow(/Component 'missing' not found in target project/);
      });
    });

    describe('custom supported connections parameter', () => {
      it('should use custom list', () => {
        setupReactProject();
        setupTrpcProject();
        // Default works
        expect(
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
          }).connection,
        ).toEqual({ source: 'react', target: 'ts#trpc-api' });
        // Empty list fails
        expect(() =>
          resolveConnection(
            tree,
            { sourceProject: 'frontend', targetProject: 'api' },
            [],
          ),
        ).toThrow(/does not support a connection/);
      });

      it('should support custom connection types', () => {
        setupUnknownProject('s', [{ generator: 'cs', path: 'p', name: 'c' }]);
        setupUnknownProject('t', [{ generator: 'ct', path: 'p', name: 'c' }]);
        const result = resolveConnection(
          tree,
          { sourceProject: 's', targetProject: 't' },
          [{ source: 'cs', target: 'ct' }],
        );
        expect(result.connection).toEqual({ source: 'cs', target: 'ct' });
        expect(result.sourceComponent?.generator).toBe('cs');
        expect(result.targetComponent?.generator).toBe('ct');
      });
    });

    describe('resolved component metadata', () => {
      it('should return undefined components for project-level connection', () => {
        setupReactProject();
        setupTrpcProject();
        const result = resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
        });
        expect(result.sourceComponent).toBeUndefined();
        expect(result.targetComponent).toBeUndefined();
      });

      it('should return component metadata with additional fields', () => {
        setupUnknownProject('s', [
          { generator: 'cs', path: 'src/c', name: 'n', port: 8080 },
        ]);
        setupUnknownProject('t', [
          { generator: 'ct', path: 'src/c', name: 'n' },
        ]);
        const result = resolveConnection(
          tree,
          { sourceProject: 's', targetProject: 't' },
          [{ source: 'cs', target: 'ct' }],
        );
        expect(result.sourceComponent).toEqual({
          generator: 'cs',
          path: 'src/c',
          name: 'n',
          port: 8080,
        });
        expect(result.targetComponent).toEqual({
          generator: 'ct',
          path: 'src/c',
          name: 'n',
        });
      });
    });

    describe('error message quality', () => {
      it('should include project types in unsupported error', () => {
        setupTrpcProject('a1');
        setupFastApiProject('a2');
        expect(() =>
          resolveConnection(tree, { sourceProject: 'a1', targetProject: 'a2' }),
        ).toThrow(
          'This generator does not support a connection from a1 (ts#trpc-api) to a2 (py#fast-api)',
        );
      });

      it('should include component types in unsupported error', () => {
        setupUnknownProject('s', [{ generator: 'ga', path: 'p', name: 'a' }]);
        setupUnknownProject('t', [{ generator: 'gb', path: 'p', name: 'b' }]);
        expect(() =>
          resolveConnection(tree, { sourceProject: 's', targetProject: 't' }),
        ).toThrow(
          'This generator does not support a connection from s (ga) to t (gb)',
        );
      });

      it('should list all connections in ambiguity error', () => {
        setupReactProject('s', [{ generator: 'cs', path: 'p', name: 'c' }]);
        setupTrpcProject('t', [{ generator: 'ct', path: 'p', name: 'c' }]);
        expect(() =>
          resolveConnection(tree, { sourceProject: 's', targetProject: 't' }, [
            { source: 'react', target: 'ts#trpc-api' },
            { source: 'cs', target: 'ct' },
          ]),
        ).toThrow(/Ambiguous.*react -> ts#trpc-api.*cs -> ct/);
      });

      it('should list available components when not found', () => {
        setupReactProject('frontend', [
          { generator: 'g1', path: 'p1' },
          { generator: 'g2', path: 'p2', name: 'named' },
        ]);
        setupTrpcProject();
        expect(() =>
          resolveConnection(tree, {
            sourceProject: 'frontend',
            targetProject: 'api',
            sourceComponent: 'x',
          }),
        ).toThrow(
          "Component 'x' not found in source project frontend. Available components: g1, named",
        );
      });
    });
  });

  describe('determineProjectType', () => {
    it('should identify py#fast-api by metadata', () => {
      setupFastApiProject('api');
      expect(determineProjectType(tree, 'api')).toBe('py#fast-api');
    });

    it('should identify py#fast-api by pyproject.toml', () => {
      setupUnknownProject('api');
      tree.write(
        'apps/api/pyproject.toml',
        `[project]\ndependencies = ["fastapi"]`,
      );
      expect(determineProjectType(tree, 'api')).toBe('py#fast-api');
    });

    it('should identify ts#trpc-api by metadata', () => {
      setupTrpcProject();
      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should allow unqualified project name', () => {
      updateJson(tree, 'package.json', (p) => ({
        ...p,
        name: '@scope/source',
      }));
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: '@scope/api',
          root: 'apps/api',
          metadata: { apiType: 'trpc' },
        }),
      );
      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify ts#trpc-api by AppRouter in index.ts', () => {
      setupUnknownProject('api');
      tree.write(
        'apps/api/src/index.ts',
        'export type { AppRouter } from "./router";',
      );
      tree.write('apps/api/src/router.ts', 'export type AppRouter = any;');
      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify ts#trpc-api by AppRouter in router.ts', () => {
      setupUnknownProject('api');
      tree.write('apps/api/src/index.ts', '');
      tree.write('apps/api/src/router.ts', 'export type AppRouter = any;');
      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify ts#trpc-api by AppRouter in lambdas/router.ts', () => {
      setupUnknownProject('api');
      tree.write('apps/api/src/index.ts', '');
      tree.write(
        'apps/api/src/lambdas/router.ts',
        'export type AppRouter = any;',
      );
      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify react by main.tsx', () => {
      setupReactProject();
      expect(determineProjectType(tree, 'frontend')).toBe('react');
    });

    it('should identify react using sourceRoot', () => {
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
          sourceRoot: 'apps/frontend/source',
        }),
      );
      tree.write('apps/frontend/source/main.tsx', '');
      expect(determineProjectType(tree, 'frontend')).toBe('react');
    });

    it('should identify smithy (model project)', () => {
      setupSmithyProject();
      expect(determineProjectType(tree, 'api-model')).toBe('smithy');
    });

    it('should identify smithy (backend project)', () => {
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: { generator: 'ts#smithy-api' },
        }),
      );
      expect(determineProjectType(tree, 'api-backend')).toBe('smithy');
    });

    it('should return undefined for unknown', () => {
      setupUnknownProject();
      expect(determineProjectType(tree, 'unknown')).toBeUndefined();
    });
  });

  describe('connectionGenerator', () => {
    it('should call fastApiReactGenerator for react -> py#fast-api', async () => {
      setupReactProject();
      setupFastApiProject();
      await connectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'api',
      });
      expect(fastApiReactGenerator).toHaveBeenCalledWith(tree, {
        frontendProjectName: 'frontend',
        fastApiProjectName: 'api',
      });
    });

    it('should call trpcReactGenerator for react -> ts#trpc-api', async () => {
      setupReactProject();
      setupTrpcProject();
      await connectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'api',
      });
      expect(trpcReactGenerator).toHaveBeenCalledWith(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'api',
      });
    });

    it('should call smithyReactConnectionGenerator for react -> smithy (model)', async () => {
      setupReactProject();
      setupSmithyProject();
      await connectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'api-model',
      });
      expect(smithyReactConnectionGenerator).toHaveBeenCalledWith(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-model',
      });
    });

    it('should call smithyReactConnectionGenerator for react -> smithy (backend)', async () => {
      setupReactProject();
      tree.write(
        'apps/api-backend/project.json',
        JSON.stringify({
          name: 'api-backend',
          root: 'apps/api-backend',
          metadata: { generator: 'ts#smithy-api' },
        }),
      );
      await connectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'api-backend',
      });
      expect(smithyReactConnectionGenerator).toHaveBeenCalledWith(tree, {
        frontendProjectName: 'frontend',
        smithyModelOrBackendProjectName: 'api-backend',
      });
    });

    it('should throw for unsupported source', async () => {
      setupUnknownProject();
      setupTrpcProject();
      await expect(
        connectionGenerator(tree, {
          sourceProject: 'unknown',
          targetProject: 'api',
        }),
      ).rejects.toThrow(/does not support a connection from unknown.*to api/);
    });

    it('should throw for unsupported target', async () => {
      setupReactProject();
      setupUnknownProject();
      await expect(
        connectionGenerator(tree, {
          sourceProject: 'frontend',
          targetProject: 'unknown',
        }),
      ).rejects.toThrow(
        /does not support a connection from frontend.*to unknown/,
      );
    });

    it('should throw for unsupported connection type', async () => {
      setupTrpcProject('api1');
      setupTrpcProject('api2');
      await expect(
        connectionGenerator(tree, {
          sourceProject: 'api1',
          targetProject: 'api2',
        }),
      ).rejects.toThrow(/does not support a connection from api1.*to api2/);
    });

    it('should succeed with non-participating components', async () => {
      setupReactProject('frontend', [
        {
          generator: 'ts#runtime-config',
          path: 'src/components/RuntimeConfig',
          name: 'rc',
        },
      ]);
      setupTrpcProject();
      await connectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'api',
      });
      expect(trpcReactGenerator).toHaveBeenCalledWith(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'api',
      });
    });

    it('should throw when sourceComponent not found', async () => {
      setupReactProject();
      setupTrpcProject();
      await expect(
        connectionGenerator(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
          sourceComponent: 'missing',
        }),
      ).rejects.toThrow(/Component 'missing' not found in source project/);
    });

    it('should throw when targetComponent not found', async () => {
      setupReactProject();
      setupTrpcProject();
      await expect(
        connectionGenerator(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
          targetComponent: 'missing',
        }),
      ).rejects.toThrow(/Component 'missing' not found in target project/);
    });
  });

  describe('resolveConnection edge cases', () => {
    const customConnections: Connection[] = [
      { source: 'react', target: 'ts#trpc-api' },
      { source: 'comp-src', target: 'comp-tgt' },
    ];

    it('should return source component metadata when source matches via component (connection participant)', () => {
      // Source has no project-level type, only a component that IS a connection participant
      setupUnknownProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupUnknownProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          sourceComponent: 'my-comp',
        },
        customConnections,
      );

      expect(result.connection).toEqual({
        source: 'comp-src',
        target: 'comp-tgt',
      });
      expect(result.sourceComponent?.name).toBe('my-comp');
      expect(result.targetComponent?.name).toBe('tgt-comp');
    });

    it('should return target component metadata when target matches via component (connection participant)', () => {
      setupUnknownProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'src-comp' },
      ]);
      setupUnknownProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'my-tgt' },
      ]);

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          targetComponent: 'my-tgt',
        },
        customConnections,
      );

      expect(result.connection).toEqual({
        source: 'comp-src',
        target: 'comp-tgt',
      });
      expect(result.targetComponent?.name).toBe('my-tgt');
    });

    it('should throw when multiple components of same generator type produce multiple matches', () => {
      // Two comp-src components on source side, one comp-tgt on target
      // This produces 2 matches (one per source component)
      setupUnknownProject('source', [
        { generator: 'comp-src', path: 'src/a', name: 'comp-a' },
        { generator: 'comp-src', path: 'src/b', name: 'comp-b' },
      ]);
      setupUnknownProject('target', [
        { generator: 'comp-tgt', path: 'src/c', name: 'comp-c' },
      ]);

      expect(() =>
        resolveConnection(
          tree,
          { sourceProject: 'source', targetProject: 'target' },
          customConnections,
        ),
      ).toThrow(/Ambiguous connection from source to target/);
    });

    it('should throw when no candidates exist on either side (empty project)', () => {
      setupUnknownProject('empty1');
      setupUnknownProject('empty2');

      expect(() =>
        resolveConnection(tree, {
          sourceProject: 'empty1',
          targetProject: 'empty2',
        }),
      ).toThrow(/does not support a connection from empty1 to empty2/);
    });

    it('should throw when component is a connection participant but other side has no match', () => {
      setupUnknownProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      // Target has no comp-tgt component
      setupUnknownProject('target');

      expect(() =>
        resolveConnection(
          tree,
          { sourceProject: 'source', targetProject: 'target' },
          customConnections,
        ),
      ).toThrow(/does not support a connection from source.*to target/);
    });

    it('should resolve mixed: project-level source + component-level target', () => {
      // Source is react (project-level), target matches via component
      setupReactProject('source');
      setupUnknownProject('target', [
        { generator: 'ts#trpc-api', path: 'src/api', name: 'api-comp' },
      ]);

      const result = resolveConnection(tree, {
        sourceProject: 'source',
        targetProject: 'target',
      });

      expect(result.connection).toEqual({
        source: 'react',
        target: 'ts#trpc-api',
      });
      expect(result.sourceComponent).toBeUndefined();
      expect(result.targetComponent?.name).toBe('api-comp');
    });

    it('should resolve mixed: component-level source + project-level target', () => {
      // Source matches via component, target is trpc (project-level)
      setupUnknownProject('source', [
        { generator: 'react', path: 'src/app', name: 'react-app' },
      ]);
      setupTrpcProject('target');

      const result = resolveConnection(tree, {
        sourceProject: 'source',
        targetProject: 'target',
      });

      expect(result.connection).toEqual({
        source: 'react',
        target: 'ts#trpc-api',
      });
      expect(result.sourceComponent?.name).toBe('react-app');
      expect(result.targetComponent).toBeUndefined();
    });

    it('should handle sourceComponent specified for a project with only project-level type', () => {
      // Source is react but has no components - specifying sourceComponent should fail
      setupReactProject();
      setupTrpcProject();

      expect(() =>
        resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
          sourceComponent: 'anything',
        }),
      ).toThrow(/Component 'anything' not found in source project frontend/);
    });

    it('should handle project with metadata but no components array', () => {
      tree.write(
        'apps/proj/project.json',
        JSON.stringify({
          name: 'proj',
          root: 'apps/proj',
          metadata: { generator: 'some-generator' },
        }),
      );
      setupTrpcProject();

      expect(() =>
        resolveConnection(tree, {
          sourceProject: 'proj',
          targetProject: 'api',
          sourceComponent: 'anything',
        }),
      ).toThrow(
        /Component 'anything' not found in source project proj. Available components: none/,
      );
    });

    it('should handle component with no name (falls back to generator in available list)', () => {
      setupReactProject('frontend', [
        {
          generator: 'ts#runtime-config',
          path: 'src/components/RuntimeConfig',
        },
      ]);
      setupTrpcProject();

      expect(() =>
        resolveConnection(tree, {
          sourceProject: 'frontend',
          targetProject: 'api',
          sourceComponent: 'missing',
        }),
      ).toThrow(
        "Component 'missing' not found in source project frontend. Available components: ts#runtime-config",
      );
    });

    it('should disambiguate with sourceComponent when multiple connections match', () => {
      const connections: Connection[] = [
        { source: 'react', target: 'ts#trpc-api' },
        { source: 'comp-src', target: 'comp-tgt' },
      ];

      // Source is react AND has comp-src component; target is trpc AND has comp-tgt
      // Without specifying component, this is ambiguous
      setupReactProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupTrpcProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      // Without component: ambiguous
      expect(() =>
        resolveConnection(
          tree,
          { sourceProject: 'source', targetProject: 'target' },
          connections,
        ),
      ).toThrow(/Ambiguous/);

      // With sourceComponent: narrows to comp-src, resolves comp-src -> comp-tgt
      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          sourceComponent: 'my-comp',
        },
        connections,
      );
      expect(result.connection).toEqual({
        source: 'comp-src',
        target: 'comp-tgt',
      });
      expect(result.sourceComponent?.name).toBe('my-comp');
    });

    it('should disambiguate with targetComponent when multiple connections match', () => {
      const connections: Connection[] = [
        { source: 'react', target: 'ts#trpc-api' },
        { source: 'comp-src', target: 'comp-tgt' },
      ];

      setupReactProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupTrpcProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      // With targetComponent: narrows to comp-tgt, resolves comp-src -> comp-tgt
      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          targetComponent: 'tgt-comp',
        },
        connections,
      );
      expect(result.connection).toEqual({
        source: 'comp-src',
        target: 'comp-tgt',
      });
      expect(result.targetComponent?.name).toBe('tgt-comp');
    });

    it('should disambiguate with both sourceComponent and targetComponent', () => {
      const connections: Connection[] = [
        { source: 'react', target: 'ts#trpc-api' },
        { source: 'comp-src', target: 'comp-tgt' },
      ];

      setupReactProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupTrpcProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          sourceComponent: 'my-comp',
          targetComponent: 'tgt-comp',
        },
        connections,
      );
      expect(result.connection).toEqual({
        source: 'comp-src',
        target: 'comp-tgt',
      });
      expect(result.sourceComponent?.name).toBe('my-comp');
      expect(result.targetComponent?.name).toBe('tgt-comp');
    });

    it('should fall back to all candidates when specified component has no matching candidates', () => {
      // Source is react with a non-participating component
      // Specifying the non-participating component should still resolve via project-level
      setupReactProject('frontend', [
        { generator: 'ts#runtime-config', path: 'src/rc', name: 'rc' },
      ]);
      setupTrpcProject();

      const result = resolveConnection(tree, {
        sourceProject: 'frontend',
        targetProject: 'api',
        sourceComponent: 'rc',
      });
      expect(result.connection).toEqual({
        source: 'react',
        target: 'ts#trpc-api',
      });
    });

    it('should disambiguate to project-level connection with "." sentinel on source', () => {
      const connections: Connection[] = [
        { source: 'react', target: 'ts#trpc-api' },
        { source: 'comp-src', target: 'comp-tgt' },
      ];

      setupReactProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupTrpcProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      // Without sentinel: ambiguous
      expect(() =>
        resolveConnection(
          tree,
          { sourceProject: 'source', targetProject: 'target' },
          connections,
        ),
      ).toThrow(/Ambiguous/);

      // With "." on source: narrows to project-level, resolves react -> ts#trpc-api
      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          sourceComponent: PROJECT_COMPONENT_SENTINEL,
        },
        connections,
      );
      expect(result.connection).toEqual({
        source: 'react',
        target: 'ts#trpc-api',
      });
      expect(result.sourceComponent).toBeUndefined();
    });

    it('should disambiguate to project-level connection with "." sentinel on target', () => {
      const connections: Connection[] = [
        { source: 'react', target: 'ts#trpc-api' },
        { source: 'comp-src', target: 'comp-tgt' },
      ];

      setupReactProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupTrpcProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      // With "." on target: narrows target to project-level only
      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          targetComponent: PROJECT_COMPONENT_SENTINEL,
        },
        connections,
      );
      expect(result.connection).toEqual({
        source: 'react',
        target: 'ts#trpc-api',
      });
      expect(result.targetComponent).toBeUndefined();
    });

    it('should disambiguate with "." on both sides', () => {
      const connections: Connection[] = [
        { source: 'react', target: 'ts#trpc-api' },
        { source: 'comp-src', target: 'comp-tgt' },
      ];

      setupReactProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupTrpcProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          sourceComponent: PROJECT_COMPONENT_SENTINEL,
          targetComponent: PROJECT_COMPONENT_SENTINEL,
        },
        connections,
      );
      expect(result.connection).toEqual({
        source: 'react',
        target: 'ts#trpc-api',
      });
      expect(result.sourceComponent).toBeUndefined();
      expect(result.targetComponent).toBeUndefined();
    });

    it('should throw when "." is used but project has no project-level type', () => {
      setupUnknownProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
      ]);
      setupUnknownProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      expect(() =>
        resolveConnection(
          tree,
          {
            sourceProject: 'source',
            targetProject: 'target',
            sourceComponent: PROJECT_COMPONENT_SENTINEL,
          },
          [{ source: 'comp-src', target: 'comp-tgt' }],
        ),
      ).toThrow(/does not support a connection/);
    });
  });

  describe('side-aware component filtering', () => {
    it('should not narrow source candidates when component generator only appears as target in connections', () => {
      tree.write('apps/source/src/main.tsx', '');
      tree.write(
        'apps/source/project.json',
        JSON.stringify({
          name: 'source',
          root: 'apps/source',
          metadata: {
            components: [
              { generator: 'comp-tgt', path: 'src/comp', name: 'my-comp' },
            ],
          },
        }),
      );
      setupUnknownProject('target', [
        { generator: 'comp-tgt', path: 'src/comp', name: 'tgt-comp' },
      ]);

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          sourceComponent: 'my-comp',
        },
        [{ source: 'react', target: 'comp-tgt' }],
      );
      expect(result.connection).toEqual({
        source: 'react',
        target: 'comp-tgt',
      });
    });

    it('should not narrow target candidates when component generator only appears as source in connections', () => {
      setupUnknownProject('source', [
        { generator: 'comp-src', path: 'src/comp', name: 'src-comp' },
      ]);
      tree.write(
        'apps/target/project.json',
        JSON.stringify({
          name: 'target',
          root: 'apps/target',
          metadata: {
            apiType: 'trpc',
            components: [
              { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
            ],
          },
        }),
      );

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          targetComponent: 'my-comp',
        },
        [{ source: 'comp-src', target: 'ts#trpc-api' }],
      );
      expect(result.connection).toEqual({
        source: 'comp-src',
        target: 'ts#trpc-api',
      });
    });

    it('should narrow source candidates when component generator appears as source in connections', () => {
      tree.write('apps/source/src/main.tsx', '');
      tree.write(
        'apps/source/project.json',
        JSON.stringify({
          name: 'source',
          root: 'apps/source',
          metadata: {
            components: [
              { generator: 'comp-src', path: 'src/comp', name: 'my-comp' },
            ],
          },
        }),
      );
      setupUnknownProject('target', [
        { generator: 'some-target', path: 'src/t', name: 'tgt' },
      ]);

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          sourceComponent: 'my-comp',
        },
        [
          { source: 'react', target: 'some-target' },
          { source: 'comp-src', target: 'some-target' },
        ],
      );
      expect(result.connection).toEqual({
        source: 'comp-src',
        target: 'some-target',
      });
      expect(result.sourceComponent?.name).toBe('my-comp');
    });

    it('should narrow target candidates when component generator appears as target in connections', () => {
      setupUnknownProject('source', [
        { generator: 'some-source', path: 'src/s', name: 'src' },
      ]);
      tree.write(
        'apps/target/project.json',
        JSON.stringify({
          name: 'target',
          root: 'apps/target',
          metadata: {
            apiType: 'trpc',
            components: [
              { generator: 'comp-tgt', path: 'src/comp', name: 'my-tgt' },
            ],
          },
        }),
      );

      const result = resolveConnection(
        tree,
        {
          sourceProject: 'source',
          targetProject: 'target',
          targetComponent: 'my-tgt',
        },
        [
          { source: 'some-source', target: 'ts#trpc-api' },
          { source: 'some-source', target: 'comp-tgt' },
        ],
      );
      expect(result.connection).toEqual({
        source: 'some-source',
        target: 'comp-tgt',
      });
      expect(result.targetComponent?.name).toBe('my-tgt');
    });
  });
});
