/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  INFRA_APP_GENERATOR_INFO,
  tsInfraGenerator,
} from '../../../infra/app/generator.js';
import { readProjectConfigurationUnqualified } from '../../../utils/nx.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const infraProject = (
  overrides: Record<string, string> = {},
): ProjectConfiguration => ({
  name: 'infra',
  root: 'packages/infra',
  metadata: { generator: INFRA_APP_GENERATOR_INFO.id } as any,
  targets: {
    'deploy-sandbox': {
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          overrides['deploy-sandbox'] ??
          'cdk deploy --require-approval=never "proj-infra-sandbox/*" --express',
      },
    },
    'destroy-sandbox': {
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          overrides['destroy-sandbox'] ?? 'cdk destroy "proj-infra-sandbox/*"',
      },
    },
    deploy: {
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk deploy --require-approval=never',
      },
    },
    'destroy-ci': {
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk destroy --app ../../dist/{projectRoot}/cdk.out',
      },
    },
  },
});

describe('sandbox-pattern-nested-stacks migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should widen the stage pattern of both sandbox targets', async () => {
    addProjectConfiguration(tree, 'infra', infraProject());

    const { nextSteps } = await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets['deploy-sandbox'].options.command).toBe(
      'cdk deploy --require-approval=never "proj-infra-sandbox/**" --express',
    );
    expect(targets['destroy-sandbox'].options.command).toBe(
      'cdk destroy "proj-infra-sandbox/**"',
    );
    expect(nextSteps).toHaveLength(0);
  });

  it('should widen a renamed sandbox stage', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({ 'destroy-sandbox': 'cdk destroy "my-own-sandbox/*"' }),
    );

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets['destroy-sandbox'].options
        .command,
    ).toBe('cdk destroy "my-own-sandbox/**"');
  });

  it('should widen the pattern for stage-config projects', async () => {
    const script = 'tsx packages/common/scripts/src/infra/infra-destroy.ts';
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({
        'destroy-sandbox': `${script} packages/infra "proj-infra-sandbox/*"`,
      }),
    );

    const { nextSteps } = await migration(tree);

    // The stage pattern stays the positional argument the script reads it from.
    expect(
      readProjectConfiguration(tree, 'infra').targets['destroy-sandbox'].options
        .command,
    ).toBe(`${script} packages/infra "proj-infra-sandbox/**"`);
    expect(nextSteps).toHaveLength(0);
  });

  it('should leave targets which name no stage alone', async () => {
    addProjectConfiguration(tree, 'infra', infraProject());

    await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets.deploy.options.command).toBe(
      'cdk deploy --require-approval=never',
    );
    expect(targets['destroy-ci'].options.command).toBe(
      'cdk destroy --app ../../dist/{projectRoot}/cdk.out',
    );
  });

  it('should not touch projects from other generators', async () => {
    addProjectConfiguration(tree, 'infra', {
      ...infraProject(),
      metadata: { generator: 'ts#project' } as any,
    });

    const { nextSteps } = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets['destroy-sandbox'].options
        .command,
    ).toBe('cdk destroy "proj-infra-sandbox/*"');
    expect(nextSteps).toHaveLength(0);
  });

  it('should report a customised command rather than rewriting it', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({
        'destroy-sandbox': './scripts/my-teardown.sh "proj-infra-sandbox/*"',
      }),
    );

    const { nextSteps } = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets['destroy-sandbox'].options
        .command,
    ).toBe('./scripts/my-teardown.sh "proj-infra-sandbox/*"');
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('destroy-sandbox');
  });

  it.each([false, true])(
    'should converge a generated project (stageConfig=%s) which still has the narrow pattern',
    async (stageConfig) => {
      await tsInfraGenerator(tree, {
        name: 'infra',
        directory: 'packages',
        stageConfig,
      } as any);

      const generated = readProjectConfigurationUnqualified(tree, 'infra');
      const vended = structuredClone(generated.targets);
      expect(vended['deploy-sandbox'].options.command).toContain('-sandbox/**');
      expect(vended['destroy-sandbox'].options.command).toContain(
        '-sandbox/**',
      );

      // Narrow both patterns, as a workspace generated by an earlier version has.
      for (const targetName of ['deploy-sandbox', 'destroy-sandbox']) {
        generated.targets[targetName].options.command = generated.targets[
          targetName
        ].options.command.replace('-sandbox/**', '-sandbox/*');
      }
      updateProjectConfiguration(tree, generated.name, generated);

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toHaveLength(0);
      expect(
        readProjectConfigurationUnqualified(tree, 'infra').targets,
      ).toEqual(vended);
    },
  );

  it('should be idempotent', async () => {
    addProjectConfiguration(tree, 'infra', infraProject());

    await migration(tree);
    const afterFirst = tree.read('packages/infra/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read('packages/infra/project.json', 'utf-8')).toEqual(
      afterFirst,
    );
  });
});
