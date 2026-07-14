/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { addDockerImageScanCommands } from './docker';
import { createTreeUsingTsSolutionSetup } from './test';
import { CONTAINER_VERSIONS } from './versions';

describe('docker utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('addDockerImageScanCommands', () => {
    it('should vend a .trivyignore at the project root', () => {
      addDockerImageScanCommands(tree, {
        containerEngine: 'docker',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-my-project:latest'],
      });

      expect(tree.exists('packages/my-project/.trivyignore')).toBe(true);
      const contents = tree.read('packages/my-project/.trivyignore', 'utf-8');
      expect(contents).toContain('trivy.dev');
    });

    it('should not overwrite an existing .trivyignore', () => {
      tree.write('packages/my-project/.trivyignore', 'CVE-2021-12345\n');

      addDockerImageScanCommands(tree, {
        containerEngine: 'docker',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-my-project:latest'],
      });

      expect(tree.read('packages/my-project/.trivyignore', 'utf-8')).toBe(
        'CVE-2021-12345\n',
      );
    });

    it('should save and scan each image with the pinned Trivy image', () => {
      const commands = addDockerImageScanCommands(tree, {
        containerEngine: 'docker',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-my-project:latest'],
      });

      const joined = commands.join('\n');
      expect(joined).toContain(
        `public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy}`,
      );
      expect(joined).toContain('docker save');
      expect(joined).toContain('--severity HIGH,CRITICAL');
      expect(joined).toContain('--ignore-unfixed');
      expect(joined).toContain('--exit-code 1');
      expect(joined).toContain('--ignorefile /scan/.trivyignore');
    });

    it('should use the provided container engine', () => {
      const commands = addDockerImageScanCommands(tree, {
        containerEngine: 'finch',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-my-project:latest'],
      });

      const joined = commands.join('\n');
      expect(joined).toContain('finch save');
      expect(joined).toContain('finch run --rm');
      expect(joined).not.toContain('docker save');
    });

    it('should scan multiple images with distinct tarballs', () => {
      const commands = addDockerImageScanCommands(tree, {
        containerEngine: 'docker',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-migration:latest', 'scope-create-db-user:latest'],
      });

      const joined = commands.join('\n');
      expect(joined).toContain('image-0.tar');
      expect(joined).toContain('image-1.tar');
      expect(joined).toContain('scope-migration:latest');
      expect(joined).toContain('scope-create-db-user:latest');
    });

    it('should stage scan artifacts under dist, not the build context', () => {
      const commands = addDockerImageScanCommands(tree, {
        containerEngine: 'docker',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-my-project:latest'],
      });

      const joined = commands.join('\n');
      expect(joined).toContain('dist/packages/my-project/trivy');
    });

    it('should stage each docker target in a unique scan directory', () => {
      const agentA = addDockerImageScanCommands(tree, {
        containerEngine: 'docker',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-agent-a:latest'],
      });
      const agentB = addDockerImageScanCommands(tree, {
        containerEngine: 'docker',
        projectRoot: 'packages/my-project',
        imageTags: ['scope-agent-b:latest'],
      });

      expect(agentA.join('\n')).toContain(
        'dist/packages/my-project/trivy/scope-agent-a-latest',
      );
      expect(agentB.join('\n')).toContain(
        'dist/packages/my-project/trivy/scope-agent-b-latest',
      );
    });
  });
});
