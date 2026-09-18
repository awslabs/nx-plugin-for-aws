/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { agentcoreHarnessGenerator } from '../../../agentcore-harness/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const APP_MODULE_FILE =
  'packages/common/terraform/src/app/harnesses/my-harness/my-harness.tf';

const divergedMessage = (filePath: string) =>
  `${filePath}: has diverged from the generated shape - left untouched. To wait for the execution role to propagate before the Harness is created, compare it against the agentcore-harness generator's Terraform template and add the time_sleep.execution_role_propagation resource the Harness depends on.`;

const TIME_PROVIDER = 'source  = "hashicorp/time"';
const TIME_SLEEP = 'resource "time_sleep" "execution_role_propagation"';

const generateHarness = (tree: Tree, name = 'my-harness') =>
  agentcoreHarnessGenerator(tree, { name, iac: 'terraform' });

/**
 * Reverts what this migration adds, so the fixture is the module an upgrading
 * workspace has: the wait is absent and the Harness depends on the role policy
 * alone.
 */
const revertPropagationWait = (tree: Tree, filePath = APP_MODULE_FILE) => {
  const contents = tree.read(filePath, 'utf-8')!;
  const withoutWait = contents
    .replace(
      /# IAM is eventually consistent[\s\S]*?resource "time_sleep" "execution_role_propagation" \{[\s\S]*?\n\}\n\n/,
      '',
    )
    .replace(
      /    time = \{\n      source  = "hashicorp\/time"\n      version = "[^"]+"\n    \}\n/,
      '',
    )
    .replace(
      'depends_on = [time_sleep.execution_role_propagation]',
      'depends_on = [aws_iam_role_policy.execution_role]',
    );
  tree.write(filePath, withoutWait);
};

const generatePreFixHarness = async (tree: Tree, name = 'my-harness') => {
  await generateHarness(tree, name);
  revertPropagationWait(
    tree,
    `packages/common/terraform/src/app/harnesses/${name}/${name}.tf`,
  );
};

describe('terraform-harness-role-propagation migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no harness module', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should start from a fixture that lacks the wait', async () => {
    // Guards the fixture: without this the assertions below could pass without
    // the migration doing anything.
    await generatePreFixHarness(tree);

    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;
    expect(contents).not.toContain(TIME_SLEEP);
    expect(contents).not.toContain(TIME_PROVIDER);
    expect(contents).toContain(
      'depends_on = [aws_iam_role_policy.execution_role]',
    );
  });

  it('should converge on what the generator writes today', async () => {
    // The migration's contract: an upgraded workspace ends up with the module a
    // workspace generated today would have.
    await generatePreFixHarness(tree);

    const result = await migration(tree);

    const fresh = createTreeUsingTsSolutionSetup();
    await generateHarness(fresh);
    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toEqual(
      fresh.read(APP_MODULE_FILE, 'utf-8'),
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should make the Harness wait on the propagation rather than the policy', async () => {
    await generatePreFixHarness(tree);

    await migration(tree);

    const contents = tree.read(APP_MODULE_FILE, 'utf-8')!;
    // The wait covers the role and its policy, and only exists alongside the
    // role the module creates.
    expect(contents).toContain(
      'depends_on = [aws_iam_role.execution_role, aws_iam_role_policy.execution_role]',
    );
    expect(contents).toContain('count = var.create_execution_role ? 1 : 0');
    expect(contents).toContain('create_duration = "30s"');
    // The Harness is ordered after the wait, not the policy.
    expect(contents).toContain(
      'depends_on = [time_sleep.execution_role_propagation]',
    );
    expect(contents).not.toContain(
      'depends_on = [aws_iam_role_policy.execution_role]\n}',
    );
  });

  it('should declare the time provider the wait needs', async () => {
    await generatePreFixHarness(tree);

    await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toContain(TIME_PROVIDER);
  });

  it('should migrate every harness module in the workspace', async () => {
    await generatePreFixHarness(tree);
    await generatePreFixHarness(tree, 'other-harness');

    const result = await migration(tree);

    for (const file of [
      APP_MODULE_FILE,
      'packages/common/terraform/src/app/harnesses/other-harness/other-harness.tf',
    ]) {
      expect(tree.read(file, 'utf-8')).toContain(TIME_SLEEP);
    }
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a diverged module', async () => {
    await generatePreFixHarness(tree);
    tree.write(
      APP_MODULE_FILE,
      'resource "aws_bedrockagentcore_harness" "mine" {\n  harness_name = "custom"\n}\n',
    );

    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).not.toContain(TIME_SLEEP);
    expect(result.nextSteps).toEqual([divergedMessage(APP_MODULE_FILE)]);
  });

  it('should be idempotent', async () => {
    await generatePreFixHarness(tree);

    await migration(tree);
    const afterFirstRun = tree.read(APP_MODULE_FILE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toEqual(afterFirstRun);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a module generated with the wait untouched', async () => {
    await generateHarness(tree);
    const generated = tree.read(APP_MODULE_FILE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(APP_MODULE_FILE, 'utf-8')).toEqual(generated);
    expect(result.nextSteps).toEqual([]);
  });
});
