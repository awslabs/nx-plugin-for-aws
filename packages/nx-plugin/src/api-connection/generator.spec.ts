/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { apiConnectionGenerator, determineProjectType } from './generator';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { vi, expect, describe, it, beforeEach } from 'vitest';
import trpcReactGenerator from '../trpc/react/generator';
import fastApiReactGenerator from '../py/fast-api/react/generator';

// Mock the generators
vi.mock('../trpc/react/generator', () => ({
  default: vi.fn(),
}));

vi.mock('../py/fast-api/react/generator', () => ({
  default: vi.fn(),
}));

describe('api connection generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.clearAllMocks();
  });

  describe('generator', () => {
    it('should call fastApiReactGenerator for react -> py#fast-api connection', async () => {
      // Setup a React project
      tree.write('apps/frontend/src/main.tsx', '');
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
        }),
      );

      // Setup a FastAPI project
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
          metadata: {
            apiType: 'fast-api',
          },
        }),
      );

      await apiConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'api',
        auth: 'IAM',
      });

      expect(fastApiReactGenerator).toHaveBeenCalledWith(tree, {
        frontendProjectName: 'frontend',
        fastApiProjectName: 'api',
        auth: 'IAM',
      });
    });

    it('should call trpcReactGenerator for react -> ts#trpc-api connection', async () => {
      // Setup a React project
      tree.write('apps/frontend/src/main.tsx', '');
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
        }),
      );

      // Setup a tRPC API project
      tree.write(
        'apps/api/src/index.ts',
        'export type { AppRouter } from "./router";',
      );
      tree.write('apps/api/src/router.ts', 'export type AppRouter = any;');
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
          metadata: {
            apiType: 'trpc',
          },
        }),
      );

      await apiConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'api',
        auth: 'IAM',
      });

      expect(trpcReactGenerator).toHaveBeenCalledWith(tree, {
        frontendProjectName: 'frontend',
        backendProjectName: 'api',
        auth: 'IAM',
      });
    });

    it('should throw error for unsupported source project type', async () => {
      // Setup an unknown project type
      tree.write(
        'apps/unknown/project.json',
        JSON.stringify({
          name: 'unknown',
          root: 'apps/unknown',
        }),
      );

      // Setup a tRPC API project
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
          metadata: {
            apiType: 'trpc',
          },
        }),
      );

      await expect(
        apiConnectionGenerator(tree, {
          sourceProject: 'unknown',
          targetProject: 'api',
          auth: 'IAM',
        }),
      ).rejects.toThrow(
        'This generator does not support selected source project unknown',
      );
    });

    it('should throw error for unsupported target project type', async () => {
      // Setup a React project
      tree.write('apps/frontend/src/main.tsx', '');
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
        }),
      );

      // Setup an unknown project type
      tree.write(
        'apps/unknown/project.json',
        JSON.stringify({
          name: 'unknown',
          root: 'apps/unknown',
        }),
      );

      await expect(
        apiConnectionGenerator(tree, {
          sourceProject: 'frontend',
          targetProject: 'unknown',
          auth: 'IAM',
        }),
      ).rejects.toThrow(
        'This generator does not support selected target project unknown',
      );
    });

    it('should throw error for unsupported connection type', async () => {
      // Setup two tRPC API projects
      tree.write(
        'apps/api1/project.json',
        JSON.stringify({
          name: 'api1',
          root: 'apps/api1',
          metadata: {
            apiType: 'trpc',
          },
        }),
      );
      tree.write(
        'apps/api2/project.json',
        JSON.stringify({
          name: 'api2',
          root: 'apps/api2',
          metadata: {
            apiType: 'trpc',
          },
        }),
      );

      await expect(
        apiConnectionGenerator(tree, {
          sourceProject: 'api1',
          targetProject: 'api2',
          auth: 'IAM',
        }),
      ).rejects.toThrow(
        'This generator does not support a connection from api1 (ts#trpc-api) to api2 (ts#trpc-api)',
      );
    });
  });

  describe('determineProjectType', () => {
    it('should identify py#fast-api project by metadata', () => {
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
          metadata: {
            apiType: 'fast-api',
          },
        }),
      );

      expect(determineProjectType(tree, 'api')).toBe('py#fast-api');
    });

    it('should identify py#fast-api project by pyproject.toml dependencies', () => {
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
        }),
      );
      tree.write(
        'apps/api/pyproject.toml',
        `[project]
dependencies = ["fastapi"]`,
      );

      expect(determineProjectType(tree, 'api')).toBe('py#fast-api');
    });

    it('should identify ts#trpc-api project by metadata', () => {
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
          metadata: {
            apiType: 'trpc',
          },
        }),
      );

      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify ts#trpc-api project by AppRouter export in index.ts', () => {
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
        }),
      );
      tree.write(
        'apps/api/src/index.ts',
        'export type { AppRouter } from "./router";',
      );
      tree.write('apps/api/src/router.ts', 'export type AppRouter = any;');

      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify ts#trpc-api project by AppRouter export in router.ts', () => {
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
        }),
      );
      tree.write('apps/api/src/index.ts', '');
      tree.write('apps/api/src/router.ts', 'export type AppRouter = any;');

      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify ts#trpc-api project by AppRouter export in lambdas/router.ts', () => {
      tree.write(
        'apps/api/project.json',
        JSON.stringify({
          name: 'api',
          root: 'apps/api',
        }),
      );
      tree.write('apps/api/src/index.ts', '');
      tree.write(
        'apps/api/src/lambdas/router.ts',
        'export type AppRouter = any;',
      );

      expect(determineProjectType(tree, 'api')).toBe('ts#trpc-api');
    });

    it('should identify react project by main.tsx file', () => {
      tree.write(
        'apps/frontend/project.json',
        JSON.stringify({
          name: 'frontend',
          root: 'apps/frontend',
        }),
      );
      tree.write('apps/frontend/src/main.tsx', '');

      expect(determineProjectType(tree, 'frontend')).toBe('react');
    });

    it('should identify react project using sourceRoot', () => {
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

    it('should return undefined for unknown project type', () => {
      tree.write(
        'apps/unknown/project.json',
        JSON.stringify({
          name: 'unknown',
          root: 'apps/unknown',
        }),
      );

      expect(determineProjectType(tree, 'unknown')).toBeUndefined();
    });
  });
});
