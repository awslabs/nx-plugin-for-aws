/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProjectConfiguration, Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { assignPort } from './port';

describe('port utilities', () => {
  let tree: Tree;
  const mockProject: ProjectConfiguration = {
    name: 'test-project',
    root: 'apps/test-project',
    sourceRoot: 'apps/test-project/src',
    projectType: 'application',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('assignPort', () => {
    it('should return start port when no existing projects', () => {
      const project = { ...mockProject };
      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3000);
      expect((project.metadata as any)?.ports).toEqual([3000]);
    });

    it('should increment port based on existing projects with old port format', () => {
      // Create first project with old port metadata format
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            port: 3000,
          },
        }),
      );

      const project = { ...mockProject };
      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3001);
      expect((project.metadata as any)?.ports).toEqual([3001]);
    });

    it('should increment port based on existing projects with new ports array format', () => {
      // Create first project with new ports array metadata format
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            ports: [3000],
          },
        }),
      );

      const project = { ...mockProject };
      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3001);
      expect((project.metadata as any)?.ports).toEqual([3001]);
    });

    it('should increment port based on multiple existing projects with mixed formats', () => {
      // Create multiple projects with mixed port metadata formats
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            port: 3000, // old format
          },
        }),
      );

      tree.write(
        'apps/project2/project.json',
        JSON.stringify({
          name: 'project2',
          metadata: {
            ports: [3001, 3002], // new format with multiple ports
          },
        }),
      );

      tree.write(
        'apps/project3/project.json',
        JSON.stringify({
          name: 'project3',
          metadata: {
            ports: [3003], // new format with single port
          },
        }),
      );

      const project = { ...mockProject };
      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3004);
      expect((project.metadata as any)?.ports).toEqual([3004]);
    });

    it('should handle projects without port metadata', () => {
      // Create projects without port metadata
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
        }),
      );

      tree.write(
        'apps/project2/project.json',
        JSON.stringify({
          name: 'project2',
          metadata: {
            ports: [3000],
          },
        }),
      );

      const project = { ...mockProject };
      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3001);
      expect((project.metadata as any)?.ports).toEqual([3001]);
    });

    it('should work with different start ports', () => {
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            port: 8000,
          },
        }),
      );

      const project = { ...mockProject };
      const port = assignPort(tree, project, 8000);

      expect(port).toBe(8001);
      expect((project.metadata as any)?.ports).toEqual([8001]);
    });

    it('should add port to existing ports array', () => {
      const project = {
        ...mockProject,
        metadata: {
          ports: [4000, 4001],
          someOtherData: 'preserved'
        } as any,
      };

      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3000);
      expect((project.metadata as any)?.ports).toEqual([4000, 4001, 3000]);
      expect((project.metadata as any)?.someOtherData).toBe('preserved');
    });

    it('should find next available port when start port is taken', () => {
      // Create projects that occupy consecutive ports
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            ports: [3000, 3001, 3002],
          },
        }),
      );

      tree.write(
        'apps/project2/project.json',
        JSON.stringify({
          name: 'project2',
          metadata: {
            port: 3003,
          },
        }),
      );

      const project = { ...mockProject };
      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3004);
      expect((project.metadata as any)?.ports).toEqual([3004]);
    });

    it('should initialize metadata if not present', () => {
      const project = { ...mockProject };
      delete project.metadata;

      const port = assignPort(tree, project, 3000);

      expect(port).toBe(3000);
      expect((project.metadata as any)).toBeDefined();
      expect((project.metadata as any)?.ports).toEqual([3000]);
    });
  });
});
