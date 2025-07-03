/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventSource } from './schema';

/**
 * Mapping of EventSource to the corresponding return type from @types/aws-lambda
 * @see https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/aws-lambda/trigger
 */
export const TS_HANDLER_RETURN_TYPES = {
  Any: {
    type: 'any',
    imports: [],
  },
  AlbSchema: {
    type: 'ALBResult',
    imports: ['ALBResult'],
  },
  APIGatewayProxyEventSchema: {
    type: 'APIGatewayProxyResult',
    imports: ['APIGatewayProxyResult'],
  },
  APIGatewayRequestAuthorizerEventSchema: {
    type: 'APIGatewayAuthorizerResult',
    imports: ['APIGatewayAuthorizerResult'],
  },
  APIGatewayTokenAuthorizerEventSchema: {
    type: 'APIGatewayAuthorizerResult',
    imports: ['APIGatewayAuthorizerResult'],
  },
  APIGatewayProxyEventV2Schema: {
    type: 'APIGatewayProxyResultV2',
    imports: ['APIGatewayProxyResultV2'],
  },
  APIGatewayProxyWebsocketEventSchema: {
    type: 'APIGatewayProxyResultV2',
    imports: ['APIGatewayProxyResultV2'],
  },
  APIGatewayRequestAuthorizerEventV2Schema: {
    type: 'APIGatewayAuthorizerResult',
    imports: ['APIGatewayAuthorizerResult'],
  },
  CloudFormationCustomResourceCreateSchema: {
    type: 'void',
    imports: [],
  },
  CloudFormationCustomResourceUpdateSchema: {
    type: 'void',
    imports: [],
  },
  CloudFormationCustomResourceDeleteSchema: {
    type: 'void',
    imports: [],
  },
  CloudWatchLogsSchema: {
    type: 'void',
    imports: [],
  },
  DynamoDBStreamSchema: {
    type: 'DynamoDBBatchResponse | void',
    imports: ['DynamoDBBatchResponse'],
  },
  EventBridgeSchema: {
    type: 'void',
    imports: [],
  },
  KafkaMskEventSchema: {
    type: 'void',
    imports: [],
  },
  KafkaSelfManagedEventSchema: {
    type: 'void',
    imports: [],
  },
  KinesisDataStreamSchema: {
    type: 'KinesisStreamBatchResponse | void',
    imports: ['KinesisStreamBatchResponse'],
  },
  KinesisFirehoseSchema: {
    type: 'FirehoseTransformationResult',
    imports: ['FirehoseTransformationResult'],
  },
  KinesisDynamoDBStreamSchema: {
    type: 'KinesisStreamBatchResponse | void',
    imports: ['KinesisStreamBatchResponse'],
  },
  KinesisFirehoseSqsSchema: {
    type: 'FirehoseTransformationResult',
    imports: ['FirehoseTransformationResult'],
  },
  LambdaFunctionUrlSchema: {
    type: 'LambdaFunctionURLResult',
    imports: ['LambdaFunctionURLResult'],
  },
  S3EventNotificationEventBridgeSchema: {
    type: 'void',
    imports: [],
  },
  S3Schema: {
    type: 'void',
    imports: [],
  },
  S3ObjectLambdaEventSchema: {
    type: 'void',
    imports: [],
  },
  S3SqsEventNotificationSchema: {
    type: 'SQSBatchResponse | void',
    imports: ['SQSBatchResponse'],
  },
  SesSchema: {
    type: 'void',
    imports: [],
  },
  SnsSchema: {
    type: 'void',
    imports: [],
  },
  SqsSchema: {
    type: 'SQSBatchResponse | void',
    imports: ['SQSBatchResponse'],
  },
  TransferFamilySchema: {
    type: 'TransferFamilyAuthorizerResult',
    imports: ['TransferFamilyAuthorizerResult'],
  },
  VpcLatticeSchema: {
    type: 'void',
    imports: [],
  },
  VpcLatticeV2Schema: {
    type: 'void',
    imports: [],
  },
  /**
   * The below Cognito triggers must return the same type as the input event.
   * Due to mismatches between @types/aws-lambda and powertools schemas, we choose the zod input type.
   */
  PreSignupTriggerSchema: {
    type: 'z.infer<typeof PreSignupTriggerSchema>',
    imports: [],
  },
  PostConfirmationTriggerSchema: {
    type: 'z.infer<typeof PostConfirmationTriggerSchema>',
    imports: [],
  },
  CustomMessageTriggerSchema: {
    type: 'z.infer<typeof CustomMessageTriggerSchema>',
    imports: [],
  },
  MigrateUserTriggerSchema: {
    type: 'z.infer<typeof MigrateUserTriggerSchema>',
    imports: [],
  },
  CustomSMSSenderTriggerSchema: {
    type: 'z.infer<typeof CustomSMSSenderTriggerSchema>',
    imports: [],
  },
  CustomEmailSenderTriggerSchema: {
    type: 'z.infer<typeof CustomEmailSenderTriggerSchema>',
    imports: [],
  },
  DefineAuthChallengeTriggerSchema: {
    type: 'z.infer<typeof DefineAuthChallengeTriggerSchema>',
    imports: [],
  },
  CreateAuthChallengeTriggerSchema: {
    type: 'z.infer<typeof CreateAuthChallengeTriggerSchema>',
    imports: [],
  },
  VerifyAuthChallengeTriggerSchema: {
    type: 'z.infer<typeof VerifyAuthChallengeTriggerSchema>',
    imports: [],
  },
  PreTokenGenerationTriggerSchemaV1: {
    type: 'z.infer<typeof PreTokenGenerationTriggerSchemaV1>',
    imports: [],
  },
  PreTokenGenerationTriggerSchemaV2AndV3: {
    type: 'z.infer<typeof PreTokenGenerationTriggerSchemaV2AndV3>',
    imports: [],
  },
} satisfies Record<EventSource, { type: string; imports: string[] }>;
