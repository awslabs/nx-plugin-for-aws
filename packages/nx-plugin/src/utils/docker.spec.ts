/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProjectConfiguration, Tree } from '@nx/devkit';
import { addDockerScanTarget } from './docker';
import { createTreeUsingTsSolutionSetup } from './test';
import { CONTAINER_VERSIONS } from './versions';

describe('docker utils', () => {
  let tree: Tree;

  const makeProject = (): ProjectConfiguration => ({
    name: 'my-project',
    root: 'packages/my-project',
    targets: {
      'my-agent-docker': { executor: 'nx:run-commands', options: {} },
    },
  });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('addDockerScanTarget', () => {
    it('should vend a .trivyignore at the project root', () => {
      const project = makeProject();
      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'my-agent-trivy',
        dockerTargetName: 'my-agent-docker',
        imageTags: ['scope-my-agent:latest'],
      });

      expect(tree.exists('packages/my-project/.trivyignore')).toBe(true);
      expect(tree.read('packages/my-project/.trivyignore', 'utf-8')).toContain(
        'trivy.dev',
      );
    });

    it('should not overwrite an existing .trivyignore', () => {
      tree.write('packages/my-project/.trivyignore', 'CVE-2021-12345\n');
      const project = makeProject();

      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'my-agent-trivy',
        dockerTargetName: 'my-agent-docker',
        imageTags: ['scope-my-agent:latest'],
      });

      expect(tree.read('packages/my-project/.trivyignore', 'utf-8')).toBe(
        'CVE-2021-12345\n',
      );
    });

    it('should add a cacheable scan target depending on the docker target', () => {
      const project = makeProject();
      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'my-agent-trivy',
        dockerTargetName: 'my-agent-docker',
        imageTags: ['scope-my-agent:latest'],
      });

      const target = project.targets['my-agent-trivy'];
      expect(target.cache).toBe(true);
      expect(target.inputs).toEqual(['default', '^production']);
      expect(target.dependsOn).toEqual(['my-agent-docker']);
      expect(target.outputs).toEqual([
        '{workspaceRoot}/dist/packages/my-project/trivy/scope-my-agent-latest',
      ]);
    });

    it('should scan with the pinned Trivy image and fail on findings', () => {
      const project = makeProject();
      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'my-agent-trivy',
        dockerTargetName: 'my-agent-docker',
        imageTags: ['scope-my-agent:latest'],
      });

      const joined =
        project.targets['my-agent-trivy'].options.commands.join('\n');
      expect(joined).toContain(
        `public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy}`,
      );
      expect(joined).toContain('docker save');
      expect(joined).toContain('--severity HIGH,CRITICAL');
      expect(joined).toContain('--ignore-unfixed');
      expect(joined).toContain('--exit-code 1');
      expect(joined).toContain('--ignorefile /scan/.trivyignore');
    });

    it('should aggregate the scan target under trivy and wire build', () => {
      const project = makeProject();
      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'my-agent-trivy',
        dockerTargetName: 'my-agent-docker',
        imageTags: ['scope-my-agent:latest'],
      });

      expect(project.targets['trivy'].dependsOn).toContain('my-agent-trivy');
      expect(project.targets['build'].dependsOn).toContain('trivy');
    });

    it('should use the provided container engine', () => {
      const project = makeProject();
      addDockerScanTarget(tree, {
        project,
        containerEngine: 'finch',
        trivyTargetName: 'my-agent-trivy',
        dockerTargetName: 'my-agent-docker',
        imageTags: ['scope-my-agent:latest'],
      });

      const joined =
        project.targets['my-agent-trivy'].options.commands.join('\n');
      expect(joined).toContain('finch save');
      expect(joined).toContain('finch run --rm');
      expect(joined).not.toContain('docker save');
    });

    it('should scan multiple images with distinct tarballs', () => {
      const project = makeProject();
      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'trivy',
        dockerTargetName: 'docker',
        imageTags: ['scope-migration:latest', 'scope-create-db-user:latest'],
      });

      const joined = project.targets['trivy'].options.commands.join('\n');
      expect(joined).toContain('image-0.tar');
      expect(joined).toContain('image-1.tar');
      expect(joined).toContain('scope-migration:latest');
      expect(joined).toContain('scope-create-db-user:latest');
    });

    it('should stage each scan target in a unique directory', () => {
      const project = makeProject();
      project.targets['my-other-agent-docker'] = {
        executor: 'nx:run-commands',
        options: {},
      };

      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'my-agent-trivy',
        dockerTargetName: 'my-agent-docker',
        imageTags: ['scope-agent-a:latest'],
      });
      addDockerScanTarget(tree, {
        project,
        containerEngine: 'docker',
        trivyTargetName: 'my-other-agent-trivy',
        dockerTargetName: 'my-other-agent-docker',
        imageTags: ['scope-agent-b:latest'],
      });

      expect(
        project.targets['my-agent-trivy'].options.commands.join('\n'),
      ).toContain('dist/packages/my-project/trivy/scope-agent-a-latest');
      expect(
        project.targets['my-other-agent-trivy'].options.commands.join('\n'),
      ).toContain('dist/packages/my-project/trivy/scope-agent-b-latest');
    });
  });
});
