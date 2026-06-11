/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { App } from 'aws-cdk-lib';
import { DocsPreviewStack } from './docs-preview-stack.js';

const app = new App();

new DocsPreviewStack(app, 'NxPluginForAwsDocsPreview', {
  // The GitHub repository allowed to assume the deploy role, in "owner/repo" form.
  githubRepo: app.node.tryGetContext('githubRepo') ?? 'awslabs/nx-plugin-for-aws',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
