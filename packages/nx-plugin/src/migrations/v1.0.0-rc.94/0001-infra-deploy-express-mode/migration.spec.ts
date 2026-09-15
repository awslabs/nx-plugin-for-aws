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
    deploy: {
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: overrides.deploy ?? 'cdk deploy --require-approval=never',
      },
    },
    'deploy-sandbox': {
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          overrides['deploy-sandbox'] ??
          'cdk deploy --require-approval=never "proj-infra-sandbox/*"',
      },
    },
    'deploy-ci': {
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          'cdk deploy --require-approval=never --app ../../dist/{projectRoot}/cdk.out',
      },
    },
    destroy: {
      executor: 'nx:run-commands',
      options: { cwd: '{projectRoot}', command: 'cdk destroy' },
    },
  },
});

describe('infra-deploy-express-mode migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add --express to deploy-sandbox and leave deploy waiting', async () => {
    addProjectConfiguration(tree, 'infra', infraProject());

    const { nextSteps } = await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets.deploy.options.command).toBe(
      'cdk deploy --require-approval=never',
    );
    expect(targets['deploy-sandbox'].options.command).toBe(
      'cdk deploy --require-approval=never "proj-infra-sandbox/*" --express',
    );
    expect(nextSteps).toHaveLength(0);
  });

  // v1.0.0-rc.96 shipped --express on `deploy`, which returns before resources
  // have stabilized - not what a target that can name a production stage wants.
  it('should strip --express from a deploy target that already carries it', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({
        deploy: 'cdk deploy --require-approval=never --express',
        'deploy-sandbox':
          'cdk deploy --require-approval=never "proj-infra-sandbox/*" --express',
      }),
    );

    const { nextSteps } = await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets.deploy.options.command).toBe(
      'cdk deploy --require-approval=never',
    );
    // The sandbox keeps it, and the stage pattern stays the first positional arg.
    expect(targets['deploy-sandbox'].options.command).toBe(
      'cdk deploy --require-approval=never "proj-infra-sandbox/*" --express',
    );
    expect(nextSteps).toHaveLength(0);
  });

  it('should leave deploy-ci and destroy targets alone', async () => {
    addProjectConfiguration(tree, 'infra', infraProject());

    await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets['deploy-ci'].options.command).not.toContain('express');
    expect(targets.destroy.options.command).not.toContain('express');
  });

  // `deploy` takes a stage name that may well be beta or prod, so only its
  // sandbox counterpart opts into express mode.
  it('should only migrate deploy-sandbox for stage-config projects', async () => {
    const stageConfigDeploy =
      'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/infra';
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({
        deploy: stageConfigDeploy,
        'deploy-sandbox': `${stageConfigDeploy} "proj-infra-sandbox/*"`,
      }),
    );

    const { nextSteps } = await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets.deploy.options.command).toBe(stageConfigDeploy);
    // The stage pattern must stay the first positional argument, since that is
    // where the deploy script reads the stage name from.
    expect(targets['deploy-sandbox'].options.command).toBe(
      `${stageConfigDeploy} "proj-infra-sandbox/*" --express`,
    );
    expect(nextSteps).toHaveLength(0);
  });

  it('should not touch projects from other generators', async () => {
    const project = infraProject();
    addProjectConfiguration(tree, 'infra', {
      ...project,
      metadata: { generator: 'ts#project' } as any,
    });

    const { nextSteps } = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets.deploy.options.command,
    ).toBe('cdk deploy --require-approval=never');
    expect(nextSteps).toHaveLength(0);
  });

  it('should honour an explicit --no-express opt-out', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({
        deploy: 'cdk deploy --require-approval=never --no-express',
      }),
    );

    const { nextSteps } = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets.deploy.options.command,
    ).toBe('cdk deploy --require-approval=never --no-express');
    expect(nextSteps).toHaveLength(0);
  });

  it('should report a customised deploy-sandbox command rather than rewriting it', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({ 'deploy-sandbox': './scripts/my-custom-deploy.sh' }),
    );

    const { nextSteps } = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets['deploy-sandbox'].options
        .command,
    ).toBe('./scripts/my-custom-deploy.sh');
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('deploy-sandbox');
    expect(nextSteps[0]).toContain('--express');
  });

  // Only reported when there is something for the user to do: a custom `deploy`
  // that already waits for stabilization is in the wanted state.
  it('should report a customised deploy command only when it uses express mode', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({ deploy: './scripts/my-custom-deploy.sh --express' }),
    );

    const { nextSteps } = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets.deploy.options.command,
    ).toBe('./scripts/my-custom-deploy.sh --express');
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('deploy');
    expect(nextSteps[0]).toContain('Remove');
  });

  it.each([false, true])(
    'should converge a generated project (stageConfig=%s) stripped of the flag the generator vends',
    async (stageConfig) => {
      await tsInfraGenerator(tree, {
        name: 'infra',
        directory: 'packages',
        stageConfig,
      } as any);

      const generated = readProjectConfigurationUnqualified(tree, 'infra');
      const vended = structuredClone(generated.targets);
      // Express mode is the sandbox's alone, whichever way it was generated.
      expect(vended.deploy.options.command).not.toContain('--express');
      expect(vended['deploy-sandbox'].options.command).toContain('--express');

      // Strip it from the sandbox, and add it to deploy - the two ways a
      // workspace generated by an earlier version diverges from today's output.
      generated.targets['deploy-sandbox'].options.command = generated.targets[
        'deploy-sandbox'
      ].options.command
        .replace(' --express', '')
        .trim();
      generated.targets.deploy.options.command = `${generated.targets.deploy.options.command} --express`;
      updateProjectConfiguration(tree, generated.name, generated);

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toHaveLength(0);
      expect(
        readProjectConfigurationUnqualified(tree, 'infra').targets,
      ).toEqual(vended);
    },
  );

  it('should be idempotent', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      // Both targets start wrong, so the first run has to change each of them.
      infraProject({ deploy: 'cdk deploy --require-approval=never --express' }),
    );

    await migration(tree);
    const afterFirst = tree.read('packages/infra/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read('packages/infra/project.json', 'utf-8')).toEqual(
      afterFirst,
    );
    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets.deploy.options.command).toBe(
      'cdk deploy --require-approval=never',
    );
    expect(targets['deploy-sandbox'].options.command).toBe(
      'cdk deploy --require-approval=never "proj-infra-sandbox/*" --express',
    );
  });
});
