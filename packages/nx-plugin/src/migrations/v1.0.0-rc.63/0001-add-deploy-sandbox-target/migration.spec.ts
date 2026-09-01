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
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const TARGET = 'deploy-sandbox';

const mainTs = (stages: string[]) =>
  `import { ApplicationStage } from './stages/application-stage.js';
import { App } from '@proj/common-constructs';

const app = new App();

${stages
  .map(
    (stage) => `new ApplicationStage(app, '${stage}', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
`,
  )
  .join('\n')}
app.synth();
`;

const cdkDeployTarget = () => ({
  executor: 'nx:run-commands',
  dependsOn: ['^build', 'compile'],
  options: {
    cwd: '{projectRoot}',
    command: 'cdk deploy --require-approval=never',
  },
});

const stageConfigDeployTarget = () => ({
  executor: 'nx:run-commands',
  dependsOn: ['^build', 'compile'],
  options: {
    command:
      'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/infra',
  },
});

/**
 * Seeds a CDK infrastructure project as the generator leaves it: `ts#infra`
 * metadata, a `deploy` target and a `main.ts` declaring the given stages.
 */
const seedInfraProject = (
  tree: Tree,
  {
    name = '@proj/infra',
    root = 'packages/infra',
    stages = ['proj-infra-sandbox'],
    deploy = cdkDeployTarget(),
    main,
  }: {
    name?: string;
    root?: string;
    stages?: string[];
    deploy?: unknown;
    main?: string;
  } = {},
) => {
  addProjectConfiguration(tree, name, {
    root,
    projectType: 'application',
    metadata: { generator: INFRA_APP_GENERATOR_INFO.id } as never,
    targets: {
      build: { executor: 'nx:run-commands' },
      deploy: deploy as never,
      'deploy-ci': { executor: 'nx:run-commands' },
    },
  });
  tree.write(`${root}/src/main.ts`, main ?? mainTs(stages));
};

const sandboxTargetOf = (tree: Tree, project = '@proj/infra') =>
  readProjectConfiguration(tree, project).targets[TARGET];

describe('add-deploy-sandbox-target migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add the target deploying the sandbox stage main.ts declares', async () => {
    seedInfraProject(tree);

    const result = await migration(tree);

    expect(sandboxTargetOf(tree)).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['^build', 'compile'],
      options: {
        cwd: '{projectRoot}',
        command: 'cdk deploy --require-approval=never "proj-infra-sandbox/*"',
      },
    });
    expect(result.nextSteps).toEqual([]);
  });

  it('should pass the stage to the credential script under stageConfig', async () => {
    seedInfraProject(tree, { deploy: stageConfigDeployTarget() });

    await migration(tree);

    expect(sandboxTargetOf(tree).options).toEqual({
      command:
        'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/infra "proj-infra-sandbox/*"',
    });
  });

  it('should pick the sandbox stage when other stages are declared', async () => {
    seedInfraProject(tree, {
      stages: ['proj-infra-beta', 'proj-infra-prod', 'proj-infra-sandbox'],
    });

    await migration(tree);

    expect(sandboxTargetOf(tree).options.command).toBe(
      'cdk deploy --require-approval=never "proj-infra-sandbox/*"',
    );
  });

  it('should use a renamed sandbox stage rather than the project name', async () => {
    seedInfraProject(tree, { stages: ['my-own-sandbox'] });

    await migration(tree);

    expect(sandboxTargetOf(tree).options.command).toBe(
      'cdk deploy --require-approval=never "my-own-sandbox/*"',
    );
  });

  it('should read a double-quoted stage id', async () => {
    seedInfraProject(tree, {
      main: `const app = new App();
new ApplicationStage(app, "proj-infra-sandbox", { env: {} });
app.synth();
`,
    });

    await migration(tree);

    expect(sandboxTargetOf(tree).options.command).toBe(
      'cdk deploy --require-approval=never "proj-infra-sandbox/*"',
    );
  });

  it('should leave non-infrastructure projects alone', async () => {
    addProjectConfiguration(tree, '@proj/website', {
      root: 'packages/website',
      targets: { deploy: cdkDeployTarget() },
    });

    const result = await migration(tree);

    expect(sandboxTargetOf(tree, '@proj/website')).toBeUndefined();
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a project with no sandbox stage', async () => {
    seedInfraProject(tree, { stages: ['proj-infra-beta'] });

    const result = await migration(tree);

    expect(sandboxTargetOf(tree)).toBeUndefined();
    expect(result.nextSteps).toEqual([
      expect.stringContaining('no sandbox stage was found'),
    ]);
  });

  it('should skip and report a project whose deploy target has diverged', async () => {
    seedInfraProject(tree, {
      deploy: { executor: '@my-org/deployer:deploy', options: { stage: 'x' } },
    });

    const result = await migration(tree);

    expect(sandboxTargetOf(tree)).toBeUndefined();
    expect(result.nextSteps).toEqual([
      expect.stringContaining('no longer matches the shape'),
    ]);
  });

  it('should not overwrite an existing deploy-sandbox target', async () => {
    seedInfraProject(tree);
    const project = readProjectConfiguration(tree, '@proj/infra');
    const existing = { executor: 'nx:run-commands', options: { command: 'x' } };
    project.targets[TARGET] = existing;
    updateProjectConfiguration(tree, '@proj/infra', project);

    await migration(tree);

    expect(sandboxTargetOf(tree)).toEqual(existing);
  });

  it('should handle multiple infrastructure projects', async () => {
    seedInfraProject(tree);
    seedInfraProject(tree, {
      name: '@proj/other-infra',
      root: 'packages/other-infra',
      stages: ['proj-other-infra-sandbox'],
    });

    await migration(tree);

    expect(sandboxTargetOf(tree).options.command).toBe(
      'cdk deploy --require-approval=never "proj-infra-sandbox/*"',
    );
    expect(sandboxTargetOf(tree, '@proj/other-infra').options.command).toBe(
      'cdk deploy --require-approval=never "proj-other-infra-sandbox/*"',
    );
  });

  it('should be idempotent', async () => {
    seedInfraProject(tree);

    await migration(tree);
    const afterFirst = readProjectConfiguration(tree, '@proj/infra');

    await migration(tree);
    const afterSecond = readProjectConfiguration(tree, '@proj/infra');

    expect(afterSecond).toEqual(afterFirst);
  });
});
