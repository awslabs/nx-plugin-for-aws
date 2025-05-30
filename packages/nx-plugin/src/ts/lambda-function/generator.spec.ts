import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { tsLambdaFunctionGenerator } from './generator';
import { TsLambdaFunctionSchema } from './schema';

describe('ts lambda-function generator', () => {
  it('should generate a basic Lambda function with APIGatewayProxyHandler', async () => {
    const tree = createTreeUsingTsSolutionSetup();

    const options: TsLambdaFunctionSchema = {
      project: 'test-project',
      functionName: 'MyFunction',
      handlerType: 'APIGatewayProxyHandler',
    };

    await tsLambdaFunctionGenerator(tree, options);

    // Check that the handler file was created
    expect(tree.exists('packages/test-project/src/lambda-functions/my-function.ts')).toBe(true);
    
    // Check that the test file was created
    expect(tree.exists('packages/test-project/src/tests/my-function.spec.ts')).toBe(true);
    
    // Check that the CDK construct was created
    expect(tree.exists('packages/common/constructs/src/app/lambda-functions/test-project-my-function.ts')).toBe(true);

    // Check handler content
    const handlerContent = tree.read('packages/test-project/src/lambda-functions/my-function.ts', 'utf-8');
    expect(handlerContent).toContain('import { APIGatewayProxyHandler } from \'aws-lambda\'');
    expect(handlerContent).toContain('export const handler: APIGatewayProxyHandler');
    expect(handlerContent).toContain('statusCode: 200');

    // Check test content
    const testContent = tree.read('packages/test-project/src/tests/my-function.spec.ts', 'utf-8');
    expect(testContent).toContain('describe(\'MyFunction Lambda Handler\'');
    expect(testContent).toContain('should handle API Gateway proxy event');

    // Check CDK construct content
    const constructContent = tree.read('packages/common/constructs/src/app/lambda-functions/test-project-my-function.ts', 'utf-8');
    expect(constructContent).toContain('export class TestProjectMyFunction extends Function');
    expect(constructContent).toContain('handler: \'my-function.handler\'');
  });

  it('should generate a Lambda function with S3Handler', async () => {
    const tree = createTreeUsingTsSolutionSetup();

    const options: TsLambdaFunctionSchema = {
      project: 'test-project',
      functionName: 'S3Processor',
      handlerType: 'S3Handler',
      functionPath: 'handlers',
    };

    await tsLambdaFunctionGenerator(tree, options);

    // Check that the handler file was created in the specified path
    expect(tree.exists('packages/test-project/src/handlers/s3-processor.ts')).toBe(true);

    // Check handler content
    const handlerContent = tree.read('packages/test-project/src/handlers/s3-processor.ts', 'utf-8');
    expect(handlerContent).toContain('import { S3Handler } from \'aws-lambda\'');
    expect(handlerContent).toContain('export const handler: S3Handler');
    expect(handlerContent).toContain('for (const record of event.Records)');
  });

  it('should generate a Lambda function with any handler type', async () => {
    const tree = createTreeUsingTsSolutionSetup();

    const options: TsLambdaFunctionSchema = {
      project: 'test-project',
      functionName: 'GenericFunction',
      handlerType: 'any',
    };

    await tsLambdaFunctionGenerator(tree, options);

    // Check handler content
    const handlerContent = tree.read('packages/test-project/src/lambda-functions/generic-function.ts', 'utf-8');
    expect(handlerContent).toContain('import { Context } from \'aws-lambda\'');
    expect(handlerContent).toContain('export const handler = async (event: any, context: Context)');
    expect(handlerContent).not.toContain('@aws-lambda-powertools');
  });

  it('should update project configuration with bundle target', async () => {
    const tree = createTreeUsingTsSolutionSetup();

    const options: TsLambdaFunctionSchema = {
      project: 'test-project',
      functionName: 'TestFunction',
    };

    await tsLambdaFunctionGenerator(tree, options);

    // Check that project.json was updated
    const projectJson = JSON.parse(tree.read('packages/test-project/project.json', 'utf-8') || '{}');
    expect(projectJson.targets?.bundle).toBeDefined();
    expect(projectJson.targets.bundle.executor).toBe('@nx/esbuild:esbuild');
    expect(projectJson.targets.bundle.options.main).toBe('packages/test-project/src/lambda-functions/test-function.ts');
  });

  it('should add dependencies to package.json', async () => {
    const tree = createTreeUsingTsSolutionSetup();

    const options: TsLambdaFunctionSchema = {
      project: 'test-project',
      functionName: 'TestFunction',
      handlerType: 'EventBridgeHandler',
    };

    await tsLambdaFunctionGenerator(tree, options);

    // Check that package.json was updated
    const packageJson = JSON.parse(tree.read('packages/test-project/package.json', 'utf-8') || '{}');
    expect(packageJson.devDependencies?.['@types/aws-lambda']).toBeDefined();
    expect(packageJson.dependencies?.['@aws-lambda-powertools/logger']).toBeDefined();
    expect(packageJson.dependencies?.['@aws-lambda-powertools/metrics']).toBeDefined();
    expect(packageJson.dependencies?.['@aws-lambda-powertools/tracer']).toBeDefined();
  });
});