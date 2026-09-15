/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** The TypeScript image build target as the pre-fix generator vended it. */
const tsDockerTarget = () => ({
  cache: true,
  outputs: [
    '{workspaceRoot}/dist/packages/ts-lib/bundle/agent/my-agent/Dockerfile',
  ],
  executor: 'nx:run-commands',
  options: {
    commands: [
      'ncp packages/ts-lib/src/agent/Dockerfile dist/packages/ts-lib/bundle/agent/my-agent/Dockerfile',
      'docker build --platform linux/arm64 -t proj-my-agent:latest dist/packages/ts-lib/bundle/agent/my-agent',
    ],
    parallel: false,
  },
  dependsOn: ['bundle'],
});

/** The Python image build target as the pre-fix generator vended it. */
const pyDockerTarget = () => ({
  cache: true,
  executor: 'nx:run-commands',
  options: {
    commands: [
      'rimraf dist/packages/py_lib/docker/my-agent',
      'make-dir dist/packages/py_lib/docker/my-agent',
      'ncp dist/packages/py_lib/bundle-arm dist/packages/py_lib/docker/my-agent',
      'docker build --platform linux/arm64 -t proj-my-agent:latest dist/packages/py_lib/docker/my-agent',
    ],
    parallel: false,
  },
  dependsOn: ['bundle-arm'],
});

/** The scan target as the pre-fix generator vended it. */
const trivyTarget = () => ({
  cache: true,
  inputs: ['default', '^production'],
  outputs: ['{workspaceRoot}/dist/packages/ts-lib/trivy/proj-my-agent-latest'],
  executor: 'nx:run-commands',
  options: {
    commands: [
      'docker save -o dist/packages/ts-lib/trivy/proj-my-agent-latest/image-0.tar proj-my-agent:latest',
      'docker run --rm -v "./dist/packages/ts-lib/trivy/proj-my-agent-latest":/scan trivy image --input /scan/image-0.tar',
    ],
    parallel: false,
  },
  dependsOn: ['agent-docker'],
});

const addProject = (tree: Tree, targets: Record<string, unknown>) =>
  addProjectConfiguration(tree, 'ts-lib', {
    root: 'packages/ts-lib',
    targets: targets as never,
  });

describe('docker-target-cache-soundness migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should make the TypeScript image build target non-cacheable', async () => {
    addProject(tree, { 'agent-docker': tsDockerTarget() });

    const result = await migration(tree);

    const target = readProjectConfiguration(tree, 'ts-lib').targets[
      'agent-docker'
    ];
    expect(target.cache).toBe(false);
    // The copied Dockerfile only existed to support the caching.
    expect(target.outputs).toBeUndefined();
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should make the Python image build target non-cacheable', async () => {
    addProject(tree, { 'agent-docker': pyDockerTarget() });

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'ts-lib').targets['agent-docker'].cache,
    ).toBe(false);
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should make the scan target non-cacheable, keeping its report output', async () => {
    addProject(tree, { 'agent-trivy': trivyTarget() });

    const result = await migration(tree);

    const target = readProjectConfiguration(tree, 'ts-lib').targets[
      'agent-trivy'
    ];
    expect(target.cache).toBe(false);
    expect(target.outputs).toEqual([
      '{workspaceRoot}/dist/packages/ts-lib/trivy/proj-my-agent-latest',
    ]);
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should migrate an unprefixed docker target', async () => {
    addProject(tree, {
      docker: {
        cache: true,
        executor: 'nx:run-commands',
        options: {
          command:
            'finch build --platform linux/arm64 -t proj-migration:latest dist/packages/ts-lib/docker',
        },
      },
    });

    await migration(tree);

    expect(readProjectConfiguration(tree, 'ts-lib').targets.docker.cache).toBe(
      false,
    );
  });

  it('should leave targets it does not own alone', async () => {
    addProject(tree, {
      build: { cache: true, executor: 'nx:run-commands', options: {} },
      'agent-docker': tsDockerTarget(),
    });

    const result = await migration(tree);

    const targets = readProjectConfiguration(tree, 'ts-lib').targets;
    expect(targets.build.cache).toBe(true);
    expect(targets['agent-docker'].cache).toBe(false);
    expect(result.nextSteps).toHaveLength(0);
  });

  it('should skip and report a customised target', async () => {
    // Reworked to push a prebuilt image rather than build one, so whether it is
    // safe to cache is no longer this migration's call.
    const customised = {
      cache: true,
      executor: 'nx:run-commands',
      options: { command: 'docker push proj-my-agent:latest' },
    };
    addProject(tree, { 'agent-docker': customised });

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'ts-lib').targets['agent-docker'].cache,
    ).toBe(true);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain('ts-lib:agent-docker');
    expect(result.nextSteps[0]).toContain('"cache": false');
  });

  it('should leave a target cacheable when its product is its own declared output', async () => {
    // Exports the image to a tarball: the tarball is the artifact its success
    // stands for, is on disk, and is therefore soundly cacheable.
    addProject(tree, {
      'export-docker': {
        cache: true,
        outputs: ['{workspaceRoot}/dist/packages/ts-lib/img.tar'],
        executor: 'nx:run-commands',
        options: {
          command: 'docker save -o dist/packages/ts-lib/img.tar proj-x:latest',
        },
      },
    });

    const result = await migration(tree);

    const target = readProjectConfiguration(tree, 'ts-lib').targets[
      'export-docker'
    ];
    expect(target.cache).toBe(true);
    expect(target.outputs).toEqual([
      '{workspaceRoot}/dist/packages/ts-lib/img.tar',
    ]);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain('declares outputs of its own');
  });

  it('should leave a fixture-image test target cacheable', async () => {
    // Builds a throwaway image, but the result it stands for is the report.
    addProject(tree, {
      'e2e-docker': {
        cache: true,
        outputs: ['{workspaceRoot}/dist/packages/ts-lib/e2e'],
        executor: 'nx:run-commands',
        options: {
          commands: [
            'docker build -t fixture .',
            'vitest run --reporter=json > dist/packages/ts-lib/e2e/r.json',
          ],
        },
      },
    });

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'ts-lib').targets['e2e-docker'].cache,
    ).toBe(true);
    expect(result.nextSteps).toHaveLength(1);
  });

  it('should keep an output the user added of their own', async () => {
    addProject(tree, {
      'agent-docker': {
        ...tsDockerTarget(),
        outputs: [
          '{workspaceRoot}/dist/packages/ts-lib/bundle/agent/my-agent/Dockerfile',
          '{workspaceRoot}/dist/packages/ts-lib/custom/Dockerfile',
        ],
      },
    });

    const result = await migration(tree);

    // Its own `/Dockerfile` output is not the vended one, so the target is left
    // for the user to judge rather than rewritten.
    expect(
      readProjectConfiguration(tree, 'ts-lib').targets['agent-docker'].outputs,
    ).toContain('{workspaceRoot}/dist/packages/ts-lib/custom/Dockerfile');
    expect(result.nextSteps).toHaveLength(1);
  });

  it('should not report a target the user already made non-cacheable', async () => {
    addProject(tree, {
      'agent-docker': {
        cache: false,
        executor: 'nx:run-commands',
        options: { command: 'docker push proj-my-agent:latest' },
      },
    });

    const result = await migration(tree);

    expect(result.nextSteps).toHaveLength(0);
  });

  it('should be idempotent', async () => {
    addProject(tree, {
      'agent-docker': tsDockerTarget(),
      'agent-trivy': trivyTarget(),
    });

    const first = await migration(tree);
    const afterFirst = readProjectConfiguration(tree, 'ts-lib');

    const second = await migration(tree);
    const afterSecond = readProjectConfiguration(tree, 'ts-lib');

    expect(afterSecond).toEqual(afterFirst);
    expect(second.nextSteps).toEqual(first.nextSteps);
    expect(second.nextSteps).toHaveLength(0);
  });
});
