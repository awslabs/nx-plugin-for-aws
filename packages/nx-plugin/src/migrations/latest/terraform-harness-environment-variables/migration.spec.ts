/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { agentcoreHarnessGenerator } from '../../../agentcore-harness/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const tfModulePath = (name: string) =>
  `packages/common/terraform/src/app/harnesses/${name}/${name}.tf`;
const TF_MODULE_PATH = tfModulePath('my-harness');

const NULLABLE_ASSIGNMENT = 'environment_variables = var.environment_variables';
const COALESCED_ASSIGNMENT =
  'environment_variables = coalesce(var.environment_variables, {})';

/**
 * Generate a Terraform harness, then put its `environment_variables`
 * assignment back to the shape the generator wrote before this fix, so the
 * migration has something to converge.
 */
const generateWithOldShape = async (
  tree: Tree,
  name = 'my-harness',
): Promise<string> => {
  await agentcoreHarnessGenerator(tree, { name, iac: 'terraform' });
  const path = tfModulePath(name);
  const generated = tree.read(path, 'utf-8') ?? '';
  tree.write(
    path,
    generated.replace(COALESCED_ASSIGNMENT, NULLABLE_ASSIGNMENT),
  );
  return generated;
};

describe('terraform-harness-environment-variables migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('converges an old module on what the generator writes today', async () => {
    const generated = await generateWithOldShape(tree);
    expect(tree.read(TF_MODULE_PATH, 'utf-8')).not.toEqual(generated);

    const { nextSteps } = await migration(tree);

    expect(tree.read(TF_MODULE_PATH, 'utf-8')).toEqual(generated);
    expect(nextSteps).toEqual([]);
  });

  it('is a no-op for a module the generator wrote after the fix', async () => {
    await agentcoreHarnessGenerator(tree, {
      name: 'my-harness',
      iac: 'terraform',
    });
    const generated = tree.read(TF_MODULE_PATH, 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read(TF_MODULE_PATH, 'utf-8')).toEqual(generated);
    expect(nextSteps).toEqual([]);
  });

  it('is idempotent when re-run', async () => {
    await generateWithOldShape(tree);

    await migration(tree);
    const afterFirst = tree.read(TF_MODULE_PATH, 'utf-8');
    await migration(tree);

    expect(tree.read(TF_MODULE_PATH, 'utf-8')).toEqual(afterFirst);
  });

  it('migrates every harness module in the workspace', async () => {
    await generateWithOldShape(tree, 'my-harness');
    await generateWithOldShape(tree, 'other-harness');

    const { nextSteps } = await migration(tree);

    for (const name of ['my-harness', 'other-harness']) {
      expect(tree.read(tfModulePath(name), 'utf-8')).toContain(
        COALESCED_ASSIGNMENT,
      );
    }
    expect(nextSteps).toEqual([]);
  });

  it('leaves an edited assignment alone and reports it', async () => {
    await agentcoreHarnessGenerator(tree, {
      name: 'my-harness',
      iac: 'terraform',
    });
    const edited = (tree.read(TF_MODULE_PATH, 'utf-8') ?? '').replace(
      COALESCED_ASSIGNMENT,
      'environment_variables = merge(var.environment_variables, local.extra)',
    );
    tree.write(TF_MODULE_PATH, edited);

    const { nextSteps } = await migration(tree);

    expect(tree.read(TF_MODULE_PATH, 'utf-8')).toEqual(edited);
    expect(nextSteps).toEqual([expect.stringContaining(TF_MODULE_PATH)]);
  });

  it('does nothing in a workspace with no Terraform harness modules', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
  });
});
