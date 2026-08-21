/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as path from 'node:path';
import * as url from 'node:url';
import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { AuthorizationType, LambdaIntegration, ResponseTransferMode } from 'aws-cdk-lib/aws-apigateway';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ChatApi, ChatHarness } from '@spike-agui-harness/common-constructs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const harness = new ChatHarness(this, 'ChatHarness', {
      allowedTools: ['@builtin'],
    });

    const chatApi = new ChatApi(this, 'ChatApi', {
      integrations: ChatApi.defaultIntegrations(this).build(),
    });

    // Hand-written spike route: POST /agui — not a tRPC operation, so it is
    // attached directly to the API's public `api.root` rather than going
    // through `routerToOperations`. See SPIKE-agui-harness-validation.md Q4.
    const aguiHandler = new NodejsFunction(this, 'AguiHandler', {
      entry: path.join(__dirname, '../../../chat-api/src/agui/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_LATEST,
      timeout: Duration.seconds(90),
      tracing: Tracing.ACTIVE,
      environment: {
        HARNESS_ARN: harness.harnessArn,
      },
      bundling: {
        format: OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire as topLevelCreateRequire } from 'module'; const require = topLevelCreateRequire(import.meta.url);",
      },
    });
    harness.grantInvokeAccess(aguiHandler);

    const aguiResource = chatApi.api.root.addResource('agui');
    aguiResource.addMethod(
      'POST',
      new LambdaIntegration(aguiHandler, { responseTransferMode: ResponseTransferMode.STREAM }),
      { authorizationType: AuthorizationType.IAM },
    );

    // Spike-only: expose the Harness's managed-memory ARN so the #8 spike
    // (Memory/ListEvents reconstruction) can extract the memoryId for a
    // direct ListEvents/GetEvent CLI call after the deploy.
    new CfnOutput(this, 'ManagedMemoryArn', {
      value: harness.harness.attrMemoryManagedMemoryConfigurationArn,
    });
  }
}
