/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type EventSource =
  | 'Any'
  | 'AlbSchema'
  | 'APIGatewayProxyEventSchema'
  | 'APIGatewayRequestAuthorizerEventSchema'
  | 'APIGatewayTokenAuthorizerEventSchema'
  | 'APIGatewayProxyEventV2Schema'
  | 'APIGatewayProxyWebsocketEventSchema'
  | 'APIGatewayRequestAuthorizerEventV2Schema'
  | 'CloudFormationCustomResourceCreateSchema'
  | 'CloudFormationCustomResourceUpdateSchema'
  | 'CloudFormationCustomResourceDeleteSchema'
  | 'CloudWatchLogsSchema'
  | 'PreSignupTriggerSchema'
  | 'PostConfirmationTriggerSchema'
  | 'CustomMessageTriggerSchema'
  | 'MigrateUserTriggerSchema'
  | 'CustomSMSSenderTriggerSchema'
  | 'CustomEmailSenderTriggerSchema'
  | 'DefineAuthChallengeTriggerSchema'
  | 'CreateAuthChallengeTriggerSchema'
  | 'VerifyAuthChallengeTriggerSchema'
  | 'PreTokenGenerationTriggerSchemaV1'
  | 'PreTokenGenerationTriggerSchemaV2AndV3'
  | 'DynamoDBStreamSchema'
  | 'EventBridgeSchema'
  | 'KafkaMskEventSchema'
  | 'KafkaSelfManagedEventSchema'
  | 'KinesisDataStreamSchema'
  | 'KinesisFirehoseSchema'
  | 'KinesisDynamoDBStreamSchema'
  | 'KinesisFirehoseSqsSchema'
  | 'LambdaFunctionUrlSchema'
  | 'S3EventNotificationEventBridgeSchema'
  | 'S3Schema'
  | 'S3ObjectLambdaEventSchema'
  | 'S3SqsEventNotificationSchema'
  | 'SesSchema'
  | 'SnsSchema'
  | 'SqsSchema'
  | 'TransferFamilySchema'
  | 'VpcLatticeSchema'
  | 'VpcLatticeV2Schema';

export interface TsLambdaFunctionGeneratorSchema {
  readonly project: string;
  readonly functionName: string;
  readonly functionPath?: string;
  readonly eventSource?: EventSource;
}
