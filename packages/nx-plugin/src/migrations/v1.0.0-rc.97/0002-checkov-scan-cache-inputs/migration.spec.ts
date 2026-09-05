/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { tsInfraGenerator } from '../../../infra/app/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT = '@proj/infra';

/** The inputs the pre-fix generator declared on the scan target. */
const PRE_FIX_INPUTS = ['{workspaceRoot}/dist/{projectRoot}/cdk.out'];

/**
 * Generates an infrastructure project, then reverts the scan target's inputs to
 * the shape the pre-fix generator produced — so the fixture is what users are
 * upgrading from rather than something derived.
 */
const generatePreFixProject = async (tree: Tree) => {
  await tsInfraGenerator(tree, {
    name: 'infra',
    directory: 'packages',
  });

  const config = readProjectConfiguration(tree, PROJECT);
  config.targets.checkov.inputs = [...PRE_FIX_INPUTS];
  updateProjectConfiguration(tree, PROJECT, config);
};

describe('checkov-scan-cache-inputs migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no infrastructure project', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should start from a fixture carrying the pre-fix inputs', async () => {
    // Guards the fixture: without this the assertions below could pass without
    // the migration doing anything.
    await generatePreFixProject(tree);

    expect(
      readProjectConfiguration(tree, PROJECT).targets.checkov.inputs,
    ).toEqual(PRE_FIX_INPUTS);
  });

  it('should scope the scan target at the project rather than at dist', async () => {
    await generatePreFixProject(tree);

    const result = await migration(tree);

    const { checkov, synth } = readProjectConfiguration(tree, PROJECT).targets;
    expect(checkov.inputs).toEqual(['default']);
    // Matches the sibling that produces the template the scan reads.
    expect(checkov.inputs).toEqual(synth.inputs);
    // The report is still restored on a hit, and the scan still follows synth.
    expect(checkov.outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/checkov',
    ]);
    expect(checkov.dependsOn).toEqual(['synth']);
    expect(checkov.cache).toBe(true);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a customised scan target untouched and report it', async () => {
    await generatePreFixProject(tree);

    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.checkov.inputs = [
      '{workspaceRoot}/dist/{projectRoot}/cdk.out',
      '{projectRoot}/checkov.yml',
    ];
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, PROJECT).targets.checkov.inputs,
    ).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/cdk.out',
      '{projectRoot}/checkov.yml',
    ]);
    expect(result.nextSteps).toEqual([
      expect.stringContaining('@proj/infra:checkov'),
    ]);
  });

  it('should leave a project this generator did not create alone', async () => {
    addProjectConfiguration(tree, '@proj/other', {
      root: 'packages/other',
      targets: {
        checkov: { cache: true, inputs: [...PRE_FIX_INPUTS] },
      } as never,
    });

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, '@proj/other').targets.checkov.inputs,
    ).toEqual(PRE_FIX_INPUTS);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generatePreFixProject(tree);

    await migration(tree);
    const afterFirst = readProjectConfiguration(tree, PROJECT).targets.checkov;

    const result = await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT).targets.checkov).toEqual(
      afterFirst,
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve user infrastructure code', async () => {
    await generatePreFixProject(tree);

    const stackPath = 'packages/infra/src/stacks/application-stack.ts';
    const userStack = `import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // My own infrastructure
  }
}
`;
    tree.write(stackPath, userStack);

    await migration(tree);

    expect(tree.read(stackPath, 'utf-8')).toBe(userStack);
  });
});
