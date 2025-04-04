/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

type EventSource =
  | 'Any'
  | 'AlbModel'
  | 'APIGatewayProxyEventModel'
  | 'ApiGatewayAuthorizerToken'
  | 'ApiGatewayAuthorizerRequest'
  | 'APIGatewayProxyEventV2Model'
  | 'ApiGatewayAuthorizerRequestV2'
  | 'APIGatewayWebSocketMessageEventModel'
  | 'APIGatewayWebSocketConnectEventModel'
  | 'APIGatewayWebSocketDisconnectEventModel'
  | 'BedrockAgentEventModel'
  | 'CloudFormationCustomResourceCreateModel'
  | 'CloudFormationCustomResourceUpdateModel'
  | 'CloudFormationCustomResourceDeleteModel'
  | 'CloudwatchLogsModel'
  | 'DynamoDBStreamModel'
  | 'EventBridgeModel'
  | 'IoTCoreThingEvent'
  | 'IoTCoreThingTypeEvent'
  | 'IoTCoreThingTypeAssociationEvent'
  | 'IoTCoreThingGroupEvent'
  | 'IoTCoreAddOrRemoveFromThingGroupEvent'
  | 'IoTCoreAddOrDeleteFromThingGroupEvent'
  | 'KafkaMskEventModel'
  | 'KafkaSelfManagedEventModel'
  | 'KinesisDataStreamModel'
  | 'KinesisFirehoseModel'
  | 'KinesisFirehoseSqsModel'
  | 'LambdaFunctionUrlModel'
  | 'S3BatchOperationModel'
  | 'S3EventNotificationEventBridgeModel'
  | 'S3Model'
  | 'S3ObjectLambdaEvent'
  | 'S3SqsEventNotificationModel'
  | 'SesModel'
  | 'SnsModel'
  | 'SqsModel'
  | 'TransferFamilyAuthorizer'
  | 'VpcLatticeModel'
  | 'VpcLatticeV2Model';

export interface LambdaFunctionProjectGeneratorSchema {
  readonly project: string;
  readonly functionName: string;
  readonly functionPath?: string;
  readonly eventSource?: EventSource;
}
