/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

type EventSource =
  | 'Any'
  | 'APIGatewayProxyEvent'
  | 'APIGatewayProxyEventV2'
  | 'APIGatewayWebSocketEvent'
  | 'SecretsManagerEvent'
  | 'AppSyncResolverEvent'
  | 'ALBEvent'
  | 'BedrockAgentEvent'
  | 'CloudWatchAlarmEvent'
  | 'CloudWatchDashboardCustomWidgetEvent'
  | 'CloudWatchLogsEvent'
  | 'CodeDeployLifecycleHookEvent'
  | 'CodePipelineJobEvent'
  | 'ConnectContactFlowEvent'
  | 'DynamoDBStreamEvent'
  | 'EventBridgeEvent'
  | 'KafkaEvent'
  | 'KinesisFirehoseEvent'
  | 'KinesisStreamEvent'
  | 'LambdaFunctionUrlEvent'
  | 'S3Event'
  | 'S3EventBridgeNotificationEvent'
  | 'S3BatchOperationEvent'
  | 'SESEvent'
  | 'SNSEvent'
  | 'SQSEvent'
  | 'AWSConfigRuleEvent'
  | 'VPCLatticeEvent'
  | 'VPCLatticeEventV2'
  | 'CloudFormationCustomResourceEvent';

export interface LambdaFunctionProjectGeneratorSchema {
  readonly project: string;
  readonly functionName: string;
  readonly functionPath?: string;
  readonly eventSource?: EventSource;
}
