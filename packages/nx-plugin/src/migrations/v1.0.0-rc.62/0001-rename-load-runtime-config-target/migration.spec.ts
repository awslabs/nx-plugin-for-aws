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

const OLD_TARGET = 'load:runtime-config';
const NEW_TARGET = 'load-runtime-config';

const cdkTarget = () => ({
  executor: 'nx:run-commands',
  metadata: {
    description:
      "Load runtime config from your deployed stack for dev purposes. You must set your AWS CLI credentials whilst calling 'pnpm exec nx run @my-scope/website:load:runtime-config'",
  },
  options: {
    command:
      'aws s3 cp s3://`aws cloudformation describe-stacks`/runtime-config.json "{projectRoot}/public/runtime-config.json"',
  },
});

const terraformTarget = () => ({
  executor: 'nx:run-commands',
  metadata: {
    description:
      "Load runtime config from most recently applied terraform env for dev purposes. Copies the runtime config from the Terraform dist directory to the website's public directory.",
  },
  options: {
    command: 'node -e "..."',
    env: {
      SRC_FILE: 'dist/packages/common/terraform/runtime-config.json',
      DEST_DIR: '{projectRoot}/public',
      DEST_FILE: '{projectRoot}/public/runtime-config.json',
    },
  },
});

describe('rename-load-runtime-config-target migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no project has the target', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { build: { executor: 'nx:run-commands' } },
    });

    await migration(tree);

    const project = readProjectConfiguration(tree, 'website');
    expect(project.targets?.[NEW_TARGET]).toBeUndefined();
  });

  it('should clone the target, leaving the original in place (CDK)', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { [OLD_TARGET]: cdkTarget() },
    });

    await migration(tree);

    const project = readProjectConfiguration(tree, 'website');
    // Original preserved
    expect(project.targets?.[OLD_TARGET]).toEqual(cdkTarget());
    // Clone added
    const cloned = project.targets?.[NEW_TARGET];
    expect(cloned).toBeDefined();
    expect(cloned?.executor).toBe('nx:run-commands');
    expect(cloned?.options).toEqual(cdkTarget().options);
    // Description uses the verb syntax for the new target
    expect(cloned?.metadata?.description).toContain(
      'nx load-runtime-config @my-scope/website',
    );
    expect(cloned?.metadata?.description).not.toContain('nx run');
  });

  it('should clone the target for Terraform projects', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { [OLD_TARGET]: terraformTarget() },
    });

    await migration(tree);

    const project = readProjectConfiguration(tree, 'website');
    expect(project.targets?.[OLD_TARGET]).toEqual(terraformTarget());
    expect(project.targets?.[NEW_TARGET]?.options).toEqual(
      terraformTarget().options,
    );
  });

  it('should be a deep clone independent of the original', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { [OLD_TARGET]: terraformTarget() },
    });

    await migration(tree);

    const project = readProjectConfiguration(tree, 'website');
    expect(project.targets?.[NEW_TARGET]?.options?.env).not.toBe(
      project.targets?.[OLD_TARGET]?.options?.env,
    );
  });

  it('should not overwrite an existing new target', async () => {
    const existingNew = {
      executor: 'nx:run-commands',
      options: { command: 'echo custom' },
    };
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: {
        [OLD_TARGET]: cdkTarget(),
        [NEW_TARGET]: existingNew,
      },
    });

    await migration(tree);

    const project = readProjectConfiguration(tree, 'website');
    expect(project.targets?.[NEW_TARGET]).toEqual(existingNew);
  });

  it('should be idempotent', async () => {
    addProjectConfiguration(tree, 'website', {
      root: 'packages/website',
      targets: { [OLD_TARGET]: cdkTarget() },
    });

    await migration(tree);
    const afterFirst = readProjectConfiguration(tree, 'website');

    await migration(tree);
    const afterSecond = readProjectConfiguration(tree, 'website');

    expect(afterSecond).toEqual(afterFirst);
  });

  it('should handle multiple projects', async () => {
    addProjectConfiguration(tree, 'website-a', {
      root: 'packages/website-a',
      targets: { [OLD_TARGET]: cdkTarget() },
    });
    addProjectConfiguration(tree, 'website-b', {
      root: 'packages/website-b',
      targets: { [OLD_TARGET]: terraformTarget() },
    });
    addProjectConfiguration(tree, 'api', {
      root: 'packages/api',
      targets: { build: { executor: 'nx:run-commands' } },
    });

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'website-a').targets?.[NEW_TARGET],
    ).toBeDefined();
    expect(
      readProjectConfiguration(tree, 'website-b').targets?.[NEW_TARGET],
    ).toBeDefined();
    expect(
      readProjectConfiguration(tree, 'api').targets?.[NEW_TARGET],
    ).toBeUndefined();
  });
});
