export interface TsLambdaFunctionSchema {
  project: string;
  functionName: string;
  functionPath?: string;
  handlerType?: 'APIGatewayProxyHandler' | 'APIGatewayProxyHandlerV2' | 'S3Handler' | 'SQSHandler' | 'EventBridgeHandler' | 'DynamoDBStreamHandler' | 'ScheduledHandler' | 'SNSHandler' | 'ALBHandler' | 'CognitoUserPoolTriggerHandler' | 'CloudFormationCustomResourceHandler' | 'KinesisStreamHandler' | 'Handler' | 'any';
}