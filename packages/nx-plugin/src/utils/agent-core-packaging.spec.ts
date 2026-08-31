/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProjectConfiguration, Tree } from '@nx/devkit';
import {
  agentCoreNodeRuntime,
  agentCorePythonRuntime,
  isAgentCoreHosted,
  isContainerHosted,
  removeContainerArtifacts,
} from './agent-core-packaging.js';
import { createTreeUsingTsSolutionSetup } from './test.js';
import { LAMBDA_RUNTIME_VERSIONS } from './versions.js';

describe('agent core packaging utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('infra predicates', () => {
    it('should treat both agentcore variants as hosted', () => {
      expect(isAgentCoreHosted('agentcore')).toBe(true);
      expect(isAgentCoreHosted('agentcore-ecr')).toBe(true);
      expect(isAgentCoreHosted('none')).toBe(false);
    });

    it('should only treat agentcore-ecr as container hosted', () => {
      expect(isContainerHosted('agentcore-ecr')).toBe(true);
      expect(isContainerHosted('agentcore')).toBe(false);
      expect(isContainerHosted('none')).toBe(false);
    });
  });

  describe('managed runtimes', () => {
    it('should target the Node runtime AgentCore publishes', () => {
      expect(agentCoreNodeRuntime()).toBe('NODE_22');
    });

    it('should derive the Python runtime from the version the bundle resolves against', () => {
      expect(agentCorePythonRuntime()).toBe(
        `PYTHON_${LAMBDA_RUNTIME_VERSIONS.python.replace('.', '_')}`,
      );
    });
  });

  describe('removeContainerArtifacts', () => {
    const makeProject = (): ProjectConfiguration => ({
      name: 'my-project',
      root: 'packages/my-project',
      targets: {
        'my-agent-docker': { executor: 'nx:run-commands', options: {} },
        'my-agent-trivy': { executor: 'nx:run-commands', options: {} },
        docker: { dependsOn: ['my-agent-docker'] },
        trivy: { dependsOn: ['my-agent-trivy'] },
        build: { dependsOn: ['compile', 'docker', 'trivy'] },
        assemble: { dependsOn: ['docker'] },
      },
    });

    it('should delete the Dockerfile and the component container targets', () => {
      const project = makeProject();
      tree.write('packages/my-project/src/my-agent/Dockerfile', 'FROM node');

      removeContainerArtifacts(tree, {
        project,
        sourceDir: 'packages/my-project/src/my-agent',
        targetPrefix: 'my-agent',
      });

      expect(
        tree.exists('packages/my-project/src/my-agent/Dockerfile'),
      ).toBeFalsy();
      expect(project.targets['my-agent-docker']).toBeUndefined();
      expect(project.targets['my-agent-trivy']).toBeUndefined();
    });

    it('should drop the aggregate targets and their build edges once empty', () => {
      const project = makeProject();

      removeContainerArtifacts(tree, {
        project,
        sourceDir: 'packages/my-project/src/my-agent',
        targetPrefix: 'my-agent',
      });

      expect(project.targets['docker']).toBeUndefined();
      expect(project.targets['trivy']).toBeUndefined();
      expect(project.targets['build'].dependsOn).toEqual(['compile']);
      expect(project.targets['assemble'].dependsOn).toEqual([]);
    });

    it('should keep the aggregate targets while another component still uses them', () => {
      const project = makeProject();
      project.targets['other-agent-docker'] = {
        executor: 'nx:run-commands',
        options: {},
      };
      project.targets['docker'].dependsOn = [
        'my-agent-docker',
        'other-agent-docker',
      ];

      removeContainerArtifacts(tree, {
        project,
        sourceDir: 'packages/my-project/src/my-agent',
        targetPrefix: 'my-agent',
      });

      expect(project.targets['docker'].dependsOn).toEqual([
        'other-agent-docker',
      ]);
      expect(project.targets['other-agent-docker']).toBeDefined();
      expect(project.targets['build'].dependsOn).toContain('docker');
    });

    it('should be a no-op for a project that never built a container', () => {
      const project: ProjectConfiguration = {
        name: 'my-project',
        root: 'packages/my-project',
        targets: { build: { dependsOn: ['compile'] } },
      };

      expect(() =>
        removeContainerArtifacts(tree, {
          project,
          sourceDir: 'packages/my-project/src/my-agent',
          targetPrefix: 'my-agent',
        }),
      ).not.toThrow();
      expect(project.targets['build'].dependsOn).toEqual(['compile']);
    });
  });
});
