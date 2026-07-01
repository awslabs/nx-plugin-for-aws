/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../utils/iac';

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

export type LambdaInfraOption = 'lambda' | 'none';

export interface TsLambdaFunctionGeneratorSchema {
  readonly project: string;
  readonly name: string;
  readonly functionPath?: string;
  readonly event?: EventSource;
  readonly infra?: LambdaInfraOption;
  readonly iac: IacOption;
  readonly preferInstallDependencies?: boolean;
}
