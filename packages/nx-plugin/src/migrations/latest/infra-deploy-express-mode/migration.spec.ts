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

  it('should add --express to the deploy and deploy-sandbox targets', async () => {
    addProjectConfiguration(tree, 'infra', infraProject());

    const { nextSteps } = await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets.deploy.options.command).toBe(
      'cdk deploy --require-approval=never --express',
    );
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

  it('should add --express after the stage pattern for stage-config projects', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({
        deploy:
          'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/infra',
        'deploy-sandbox':
          'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/infra "proj-infra-sandbox/*"',
      }),
    );

    const { nextSteps } = await migration(tree);

    const { targets } = readProjectConfiguration(tree, 'infra');
    expect(targets.deploy.options.command).toBe(
      'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/infra --express',
    );
    // The stage pattern must stay the first positional argument, since that is
    // where the deploy script reads the stage name from.
    expect(targets['deploy-sandbox'].options.command).toBe(
      'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/infra "proj-infra-sandbox/*" --express',
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

  it('should report a customised deploy command rather than rewriting it', async () => {
    addProjectConfiguration(
      tree,
      'infra',
      infraProject({ deploy: './scripts/my-custom-deploy.sh' }),
    );

    const { nextSteps } = await migration(tree);

    expect(
      readProjectConfiguration(tree, 'infra').targets.deploy.options.command,
    ).toBe('./scripts/my-custom-deploy.sh');
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('deploy');
    expect(nextSteps[0]).toContain('--express');
  });

  it('should converge a generated project stripped of the flag the generator vends', async () => {
    await tsInfraGenerator(tree, {
      name: 'infra',
      directory: 'packages',
    } as any);

    const generated = readProjectConfigurationUnqualified(tree, 'infra');
    const vended = structuredClone(generated.targets);
    expect(vended.deploy.options.command).toContain('--express');
    expect(vended['deploy-sandbox'].options.command).toContain('--express');

    for (const target of ['deploy', 'deploy-sandbox']) {
      generated.targets[target].options.command = generated.targets[
        target
      ].options.command
        .replace(' --express', '')
        .trim();
    }
    updateProjectConfiguration(tree, generated.name, generated);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(readProjectConfigurationUnqualified(tree, 'infra').targets).toEqual(
      vended,
    );
  });

  it('should be idempotent', async () => {
    addProjectConfiguration(tree, 'infra', infraProject());

    await migration(tree);
    const afterFirst = tree.read('packages/infra/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(0);
    expect(tree.read('packages/infra/project.json', 'utf-8')).toEqual(
      afterFirst,
    );
    expect(
      readProjectConfiguration(tree, 'infra').targets.deploy.options.command,
    ).toBe('cdk deploy --require-approval=never --express');
  });
});
