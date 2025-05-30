/**
 * TypeScript types for options defined in schema.json
 * Update this to match schema.json if you make changes.
 */
export interface TsLambdaFunctionGeneratorSchema {
  project: string;
  functionName: string;
  functionPath?: string;
  handlerType: 'APIGatewayProxyHandler' | 'APIGatewayProxyHandlerV2' | 'S3Handler' | 'SQSHandler' | 'SNSHandler' | 'DynamoDBStreamHandler' | 'KinesisStreamHandler' | 'CloudWatchLogsHandler' | 'ALBHandler' | 'LambdaFunctionURLHandler' | 'APIGatewayAuthorizerHandler' | 'S3BatchHandler' | 'SESHandler' | 'ScheduledHandler' | 'EventBridgeHandler' | 'Handler';
}