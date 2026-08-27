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

const TARGET = 'destroy-sandbox';

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

/** The destroy target as the pre-fix generator vended it. */
const cdkDestroyTarget = () => ({
  executor: 'nx:run-commands',
  dependsOn: ['^build', 'compile'],
  options: {
    cwd: '{projectRoot}',
    command: 'cdk destroy --require-approval=never',
  },
});

const CDK_COMMAND_PATH =
  'packages/common/scripts/src/infra/stage-credentials/cdk-command.ts';

/** The command builder as the pre-fix generator vended it. */
const CDK_COMMAND_BEFORE = `export function buildCdkCommand(
  action: string,
  remainingArgs: string[],
): string[] {
  const hasRequireApproval = remainingArgs.some(
    (a) => a === '--require-approval' || a.startsWith('--require-approval='),
  );
  const defaults = hasRequireApproval ? [] : ['--require-approval=never'];
  return ['cdk', action, ...defaults, ...remainingArgs];
}
`;

const stageConfigDestroyTarget = () => ({
  executor: 'nx:run-commands',
  dependsOn: ['^build', 'compile'],
  options: {
    command:
      'tsx packages/common/scripts/src/infra/infra-destroy.ts packages/infra',
  },
});

/**
 * Seeds a CDK infrastructure project as the generator leaves it: `ts#infra`
 * metadata, a `destroy` target and a `main.ts` declaring the given stages.
 */
const seedInfraProject = (
  tree: Tree,
  {
    name = '@proj/infra',
    root = 'packages/infra',
    stages = ['proj-infra-sandbox'],
    destroy = cdkDestroyTarget(),
    main,
  }: {
    name?: string;
    root?: string;
    stages?: string[];
    destroy?: unknown;
    main?: string;
  } = {},
) => {
  addProjectConfiguration(tree, name, {
    root,
    projectType: 'application',
    metadata: { generator: INFRA_APP_GENERATOR_INFO.id } as never,
    targets: {
      build: { executor: 'nx:run-commands' },
      destroy: destroy as never,
      'destroy-ci': { executor: 'nx:run-commands' },
    },
  });
  tree.write(`${root}/src/main.ts`, main ?? mainTs(stages));
};

const sandboxTargetOf = (tree: Tree, project = '@proj/infra') =>
  readProjectConfiguration(tree, project).targets[TARGET];

describe('add-destroy-sandbox-target migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add the target destroying the sandbox stage main.ts declares', async () => {
    seedInfraProject(tree);

    const result = await migration(tree);

    expect(sandboxTargetOf(tree)).toEqual({
      executor: 'nx:run-commands',
      dependsOn: ['^build', 'compile'],
      options: {
        cwd: '{projectRoot}',
        command: 'cdk destroy --force "proj-infra-sandbox/*"',
      },
    });
    expect(result.nextSteps).toEqual([]);
  });

  it('should pass the stage to the credential script under stageConfig', async () => {
    seedInfraProject(tree, { destroy: stageConfigDestroyTarget() });

    await migration(tree);

    expect(sandboxTargetOf(tree).options).toEqual({
      command:
        'tsx packages/common/scripts/src/infra/infra-destroy.ts packages/infra "proj-infra-sandbox/*"',
    });
  });

  it('should pick the sandbox stage when other stages are declared', async () => {
    seedInfraProject(tree, {
      stages: ['proj-infra-beta', 'proj-infra-prod', 'proj-infra-sandbox'],
    });

    await migration(tree);

    expect(sandboxTargetOf(tree).options.command).toBe(
      'cdk destroy --force "proj-infra-sandbox/*"',
    );
  });

  it('should use a renamed sandbox stage rather than the project name', async () => {
    seedInfraProject(tree, { stages: ['my-own-sandbox'] });

    await migration(tree);

    expect(sandboxTargetOf(tree).options.command).toBe(
      'cdk destroy --force "my-own-sandbox/*"',
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
      'cdk destroy --force "proj-infra-sandbox/*"',
    );
  });

  it('should leave non-infrastructure projects alone', async () => {
    addProjectConfiguration(tree, '@proj/website', {
      root: 'packages/website',
      targets: { destroy: cdkDestroyTarget() },
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

  it('should skip and report a project whose destroy target has diverged', async () => {
    seedInfraProject(tree, {
      destroy: {
        executor: '@my-org/deployer:destroy',
        options: { stage: 'x' },
      },
    });

    const result = await migration(tree);

    expect(sandboxTargetOf(tree)).toBeUndefined();
    expect(result.nextSteps).toEqual([
      expect.stringContaining('no longer matches the shape'),
    ]);
  });

  it('should not overwrite an existing destroy-sandbox target', async () => {
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
      'cdk destroy --force "proj-infra-sandbox/*"',
    );
    expect(sandboxTargetOf(tree, '@proj/other-infra').options.command).toBe(
      'cdk destroy --force "proj-other-infra-sandbox/*"',
    );
  });

  describe('non-interactive destroy flag', () => {
    // `cdk destroy` has no --require-approval, so it ignores the flag and then
    // blocks on a confirmation prompt, which nx cannot answer.
    it('should swap --require-approval for --force on the destroy targets', async () => {
      seedInfraProject(tree);
      const project = readProjectConfiguration(tree, '@proj/infra');
      project.targets['destroy-ci'] = {
        executor: 'nx:run-commands',
        options: {
          cwd: '{projectRoot}',
          command:
            'cdk destroy --require-approval=never --app ../../dist/{projectRoot}/cdk.out',
        },
      };
      updateProjectConfiguration(tree, '@proj/infra', project);

      const result = await migration(tree);
      const targets = readProjectConfiguration(tree, '@proj/infra').targets;

      expect(targets.destroy.options.command).toBe('cdk destroy --force');
      expect(targets['destroy-ci'].options.command).toBe(
        'cdk destroy --force --app ../../dist/{projectRoot}/cdk.out',
      );
      expect(result.nextSteps).toEqual([]);
    });

    it('should leave a destroy target that already passes --force alone', async () => {
      seedInfraProject(tree, {
        destroy: {
          executor: 'nx:run-commands',
          options: { cwd: '{projectRoot}', command: 'cdk destroy --force' },
        },
      });

      await migration(tree);

      expect(
        readProjectConfiguration(tree, '@proj/infra').targets.destroy.options
          .command,
      ).toBe('cdk destroy --force');
    });

    it('should not add a second --force when the user already passes one', async () => {
      seedInfraProject(tree, {
        destroy: {
          executor: 'nx:run-commands',
          options: {
            cwd: '{projectRoot}',
            command: 'cdk destroy --require-approval=never --force',
          },
        },
      });

      await migration(tree);

      expect(
        readProjectConfiguration(tree, '@proj/infra').targets.destroy.options
          .command,
      ).toBe('cdk destroy --force');
    });

    it('should re-vend the command builder so destroy passes --force', async () => {
      seedInfraProject(tree);
      tree.write(CDK_COMMAND_PATH, CDK_COMMAND_BEFORE);

      const result = await migration(tree);
      const after = tree.read(CDK_COMMAND_PATH).toString();

      expect(after).toContain("action === 'destroy'");
      expect(after).toContain("['--force']");
      expect(result.nextSteps).toEqual([]);
    });

    it('should skip and report a customised command builder', async () => {
      seedInfraProject(tree);
      tree.write(
        CDK_COMMAND_PATH,
        'export function buildCdkCommand() {\n  return myOwnThing();\n}\n',
      );

      const result = await migration(tree);

      expect(tree.read(CDK_COMMAND_PATH).toString()).toContain('myOwnThing()');
      expect(tree.read(CDK_COMMAND_PATH).toString()).not.toContain('--force');
      expect(result.nextSteps).toEqual([
        expect.stringContaining('has diverged from the generated shape'),
      ]);
    });

    it('should leave workspaces with no shared scripts package alone', async () => {
      seedInfraProject(tree);

      await migration(tree);

      expect(tree.exists(CDK_COMMAND_PATH)).toBeFalsy();
    });
  });

  it('should be idempotent', async () => {
    seedInfraProject(tree);
    tree.write(CDK_COMMAND_PATH, CDK_COMMAND_BEFORE);

    await migration(tree);
    const afterFirst = readProjectConfiguration(tree, '@proj/infra');
    const builderAfterFirst = tree.read(CDK_COMMAND_PATH).toString();

    await migration(tree);
    const afterSecond = readProjectConfiguration(tree, '@proj/infra');

    expect(tree.read(CDK_COMMAND_PATH).toString()).toBe(builderAfterFirst);

    expect(afterSecond).toEqual(afterFirst);
  });
});
