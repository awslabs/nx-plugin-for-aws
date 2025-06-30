/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

type EventSource =
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
  | 'CloudwatchLogsSchema'
  | 'PreSignupTriggerSchema'
  | 'PostConfirmationTriggerSchema'
  | 'PreTokenGenerationTriggerSchema'
  | 'CustomMessageTriggerSchema'
  | 'MigrateUserTriggerSchema'
  | 'CustomSMSTriggerSchema'
  | 'CustomEmailTriggerSchema'
  | 'DefineAuthChallengeTriggerSchema'
  | 'CreateAuthChallengeTriggerSchema'
  | 'VerifyAuthChallengeResponseTriggerSchema'
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
  | 'S3ObjectLambdaEvent'
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
