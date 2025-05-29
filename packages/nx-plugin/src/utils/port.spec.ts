/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { getLocalServerPortNumber } from './port';
import { NxGeneratorInfo } from './nx';

describe('port utilities', () => {
  let tree: Tree;
  const mockGeneratorInfo: NxGeneratorInfo = {
    id: 'test-generator',
    metric: 'test-metric',
    resolvedFactoryPath: '/test/path',
    resolvedSchemaPath: '/test/schema',
    description: 'Test generator',
  };

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('getLocalServerPortNumber', () => {
    it('should return start port when no existing projects', () => {
      const port = getLocalServerPortNumber(tree, mockGeneratorInfo, 3000);
      expect(port).toBe(3000);
    });

    it('should increment port based on existing projects with same generator', () => {
      // Create first project with port metadata
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            generator: 'test-generator',
            port: 3000,
          },
        }),
      );

      const port = getLocalServerPortNumber(tree, mockGeneratorInfo, 3000);
      expect(port).toBe(3001);
    });

    it('should increment port based on multiple existing projects', () => {
      // Create multiple projects with port metadata
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            generator: 'test-generator',
            port: 3000,
          },
        }),
      );

      tree.write(
        'apps/project2/project.json',
        JSON.stringify({
          name: 'project2',
          metadata: {
            generator: 'test-generator',
            port: 3001,
          },
        }),
      );

      tree.write(
        'apps/project3/project.json',
        JSON.stringify({
          name: 'project3',
          metadata: {
            generator: 'test-generator',
            port: 3002,
          },
        }),
      );

      const port = getLocalServerPortNumber(tree, mockGeneratorInfo, 3000);
      expect(port).toBe(3003);
    });

    it('should only count projects with matching generator id', () => {
      // Create projects with different generators
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            generator: 'test-generator',
            port: 3000,
          },
        }),
      );

      tree.write(
        'apps/project2/project.json',
        JSON.stringify({
          name: 'project2',
          metadata: {
            generator: 'other-generator',
            port: 3001,
          },
        }),
      );

      tree.write(
        'apps/project3/project.json',
        JSON.stringify({
          name: 'project3',
          metadata: {
            generator: 'test-generator',
            port: 3002,
          },
        }),
      );

      const port = getLocalServerPortNumber(tree, mockGeneratorInfo, 3000);
      expect(port).toBe(3002); // Only counts 2 projects with 'test-generator'
    });

    it('should only count projects with port metadata', () => {
      // Create projects, some with port metadata, some without
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            generator: 'test-generator',
            port: 3000,
          },
        }),
      );

      tree.write(
        'apps/project2/project.json',
        JSON.stringify({
          name: 'project2',
          metadata: {
            generator: 'test-generator',
            // No port metadata
          },
        }),
      );

      tree.write(
        'apps/project3/project.json',
        JSON.stringify({
          name: 'project3',
          metadata: {
            generator: 'test-generator',
            port: 3001,
          },
        }),
      );

      const port = getLocalServerPortNumber(tree, mockGeneratorInfo, 3000);
      expect(port).toBe(3002); // Only counts 2 projects with port metadata
    });

    it('should handle projects without metadata', () => {
      // Create projects without metadata
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
            generator: 'test-generator',
            port: 3000,
          },
        }),
      );

      const port = getLocalServerPortNumber(tree, mockGeneratorInfo, 3000);
      expect(port).toBe(3001); // Only counts 1 project with matching metadata
    });

    it('should work with different start ports', () => {
      tree.write(
        'apps/project1/project.json',
        JSON.stringify({
          name: 'project1',
          metadata: {
            generator: 'test-generator',
            port: 8000,
          },
        }),
      );

      const port = getLocalServerPortNumber(tree, mockGeneratorInfo, 8000);
      expect(port).toBe(8001);
    });
  });
});
