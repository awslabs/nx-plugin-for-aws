import { Tree } from '@nx/devkit';
import {
  tsLambdaFunctionGenerator,
  LAMBDA_FUNCTION_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';

describe('ts#lambda-function generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should run successfully', async () => {
    await tsLambdaFunctionGenerator(tree, { 
      project: 'example-ts-project',
      functionName: 'TestFunction',
      handlerType: 'APIGatewayProxyHandler'
    });

    // TODO: check the tree is updated as expected
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree);

    await tsLambdaFunctionGenerator(tree, { 
      project: 'example-ts-project',
      functionName: 'TestFunction',
      handlerType: 'APIGatewayProxyHandler'
    });

    expectHasMetricTags(tree, LAMBDA_FUNCTION_GENERATOR_INFO.metric);
  });
});