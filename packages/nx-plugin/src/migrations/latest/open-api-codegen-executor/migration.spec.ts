/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type TargetConfiguration,
  type Tree,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** A codegen target as the pre-migration generators vended it. */
const shelledOutTarget = (
  generator: string,
  specPath: string,
  outputPath: string,
): TargetConfiguration => ({
  cache: true,
  executor: 'nx:run-commands',
  inputs: [{ dependentTasksOutputFiles: '**/*.json' }],
  outputs: [`{workspaceRoot}/${outputPath}`],
  options: {
    commands: [
      `nx g @aws/nx-plugin:${generator} --openApiSpecPath="${specPath}" --outputPath="${outputPath}" --no-interactive`,
    ],
  },
  dependsOn: ['my-api:openapi'],
});

describe('open-api-codegen-executor migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it.each([
    ['open-api#ts-hooks', 'ts-hooks'],
    ['open-api#ts-client', 'ts-client'],
    ['open-api#ts-metadata', 'ts-metadata'],
    ['open-api#json-metadata', 'json-metadata'],
  ])('should migrate a %s target', async (generator, expected) => {
    addProjectConfiguration(tree, 'web', {
      root: 'packages/web',
      targets: {
        'generate:my-api-client': shelledOutTarget(
          generator,
          'dist/packages/api/openapi.json',
          'packages/web/src/generated/my-api',
        ),
      },
    });

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(
      readProjectConfiguration(tree, 'web').targets['generate:my-api-client'],
    ).toEqual({
      executor: '@aws/nx-plugin:open-api-codegen',
      dependsOn: ['my-api:openapi'],
      cache: true,
      inputs: [{ dependentTasksOutputFiles: '**/*.json' }],
      outputs: ['{workspaceRoot}/packages/web/src/generated/my-api'],
      options: {
        generator: expected,
        openApiSpecPath: 'dist/packages/api/openapi.json',
        outputPath: 'packages/web/src/generated/my-api',
      },
    });
  });

  it('should migrate every codegen target across projects', async () => {
    addProjectConfiguration(tree, 'web', {
      root: 'packages/web',
      targets: {
        'generate:a-client': shelledOutTarget(
          'open-api#ts-hooks',
          'dist/a.json',
          'packages/web/src/generated/a',
        ),
        'generate:b-client': shelledOutTarget(
          'open-api#ts-hooks',
          'dist/b.json',
          'packages/web/src/generated/b',
        ),
      },
    });
    addProjectConfiguration(tree, 'constructs', {
      root: 'packages/common/constructs',
      targets: {
        'generate:a-metadata': shelledOutTarget(
          'open-api#ts-metadata',
          'dist/a.json',
          'packages/common/constructs/src/generated/a',
        ),
      },
    });

    await migration(tree);

    const executors = [
      ...Object.values(readProjectConfiguration(tree, 'web').targets),
      ...Object.values(readProjectConfiguration(tree, 'constructs').targets),
    ].map((target) => target.executor);
    expect(executors).toEqual([
      '@aws/nx-plugin:open-api-codegen',
      '@aws/nx-plugin:open-api-codegen',
      '@aws/nx-plugin:open-api-codegen',
    ]);
  });

  it('should leave the watch target untouched', async () => {
    const watchTarget = {
      executor: 'nx:run-commands',
      options: {
        commands: [
          'nx watch --projects=my-api --includeDependencies -- nx run web:"generate:my-api-client"',
        ],
      },
      continuous: true,
    };
    addProjectConfiguration(tree, 'web', {
      root: 'packages/web',
      targets: { 'watch-generate:my-api-client': watchTarget },
    });

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(
      readProjectConfiguration(tree, 'web').targets[
        'watch-generate:my-api-client'
      ],
    ).toEqual(watchTarget);
  });

  // `nx watch` runs until interrupted, which a single executor invocation cannot
  // express, so a continuous target is never reported — even where it invokes the
  // generator directly and so would otherwise look diverged.
  it.each([
    ['watch-generate:my-api-client', '--includeDependencies -- '],
    ['regen-loop', '-- '],
  ])(
    'should silently skip the continuous target %s that invokes the generator',
    async (targetName, watchArgs) => {
      const target = {
        executor: 'nx:run-commands',
        continuous: true,
        options: {
          commands: [
            `nx watch --projects=my-api ${watchArgs}nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/a.json" --outputPath="out" --no-interactive`,
          ],
        },
      };
      addProjectConfiguration(tree, 'web', {
        root: 'packages/web',
        targets: { [targetName]: target },
      });

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(readProjectConfiguration(tree, 'web').targets[targetName]).toEqual(
        target,
      );
    },
  );

  // `continuous` is the property that makes a target un-convertible, not its name.
  it('should report a diverged target named watch- that is not continuous', async () => {
    addProjectConfiguration(tree, 'web', {
      root: 'packages/web',
      targets: {
        'watch-but-not-continuous': {
          executor: 'nx:run-commands',
          options: {
            commands: [
              'nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/a.json" --outputPath="out" --no-interactive --verbose',
            ],
          },
        },
      },
    });

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([
      expect.stringContaining('web:watch-but-not-continuous'),
    ]);
  });

  it.each([
    [
      'an extra flag',
      [
        'nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/a.json" --outputPath="out" --no-interactive --verbose',
      ],
      undefined,
    ],
    [
      'a chained command',
      [
        'nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/a.json" --outputPath="out" --no-interactive',
        'echo done',
      ],
      undefined,
    ],
    [
      'an extra option',
      [
        'nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="dist/a.json" --outputPath="out" --no-interactive',
      ],
      { cwd: '{projectRoot}' },
    ],
  ])(
    'should report a target customised with %s rather than rewrite it',
    async (_label, commands, extraOptions) => {
      const target = {
        cache: true,
        executor: 'nx:run-commands',
        options: { commands, ...extraOptions },
      };
      addProjectConfiguration(tree, 'web', {
        root: 'packages/web',
        targets: { 'generate:my-api-client': target },
      });

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([
        expect.stringContaining('web:generate:my-api-client'),
      ]);
      expect(
        readProjectConfiguration(tree, 'web').targets['generate:my-api-client'],
      ).toEqual(target);
    },
  );

  it('should leave unrelated targets untouched', async () => {
    const build = {
      executor: 'nx:run-commands',
      options: { commands: ['tsc --build'] },
    };
    addProjectConfiguration(tree, 'web', {
      root: 'packages/web',
      targets: { build },
    });

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(readProjectConfiguration(tree, 'web').targets.build).toEqual(build);
  });

  it('should be idempotent', async () => {
    addProjectConfiguration(tree, 'web', {
      root: 'packages/web',
      targets: {
        'generate:my-api-client': shelledOutTarget(
          'open-api#ts-hooks',
          'dist/a.json',
          'packages/web/src/generated/a',
        ),
      },
    });

    await migration(tree);
    const afterFirstRun = tree.read('packages/web/project.json')!.toString();

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read('packages/web/project.json')!.toString()).toBe(
      afterFirstRun,
    );
  });
});
