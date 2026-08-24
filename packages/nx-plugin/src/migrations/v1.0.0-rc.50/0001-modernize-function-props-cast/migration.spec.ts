/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const API_APP_FILE = 'packages/common/constructs/src/app/apis/test-api.ts';

const OLD_API_APP_FILE = `import { Function, FunctionProps } from 'aws-cdk-lib/aws-lambda';

export class TestApi {
  public static defaultIntegrations = (scope) => {
    const rc = RuntimeConfig.ensure(scope);
    return IntegrationBuilder.rest({
      pattern: 'isolated',
      operations: routerToOperations(appRouter),
      defaultIntegrationOptions: <FunctionProps>{
        runtime: Runtime.NODEJS_LATEST,
        handler: 'index.handler',
        timeout: Duration.seconds(30),
        tracing: Tracing.ACTIVE,
      },
      buildDefaultIntegration: (op, props: FunctionProps) => {
        const handler = new Function(scope, \`TestApi\${op}Handler\`, props);
        return { handler };
      },
    });
  };
}
`;

describe('modernize-function-props-cast migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when no api app files exist', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should apply to the shape your generators produce', async () => {
    tree.write(API_APP_FILE, OLD_API_APP_FILE);

    const result = await migration(tree);

    const content = tree.read(API_APP_FILE, 'utf-8');
    expect(content).not.toContain('<FunctionProps>');
    expect(content).toContain('} as FunctionProps,');
    // Nothing left for the user to do, so nothing is reported.
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a customised file', async () => {
    tree.write(
      API_APP_FILE,
      OLD_API_APP_FILE.replace(
        '      },\n      buildDefaultIntegration:',
        '      },\n      // a customisation between the cast and buildDefaultIntegration\n      buildDefaultIntegration:',
      ),
    );

    const result = await migration(tree);

    const content = tree.read(API_APP_FILE, 'utf-8');
    expect(content).toContain('<FunctionProps>');
    expect(result.nextSteps.some((s) => s.includes(API_APP_FILE))).toBeTruthy();
  });

  it('should be idempotent', async () => {
    tree.write(API_APP_FILE, OLD_API_APP_FILE);

    await migration(tree);
    const afterFirst = tree.read(API_APP_FILE, 'utf-8');

    const secondResult = await migration(tree);

    expect(tree.read(API_APP_FILE, 'utf-8')).toEqual(afterFirst);
    expect(secondResult.nextSteps).toEqual([]);
  });
});
