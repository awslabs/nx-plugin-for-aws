/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface DocsPreviewStackProps extends StackProps {
  /** GitHub repository allowed to assume the deploy role, in "owner/repo" form. */
  readonly githubRepo: string;
}

/**
 * Infrastructure for ephemeral per-PR documentation previews.
 *
 * A single private S3 bucket and CloudFront distribution serve every PR. Each
 * PR's site lives under its own `pr-<number>/` key prefix, so previews are
 * isolated from one another and from the production docs (which are hosted
 * separately on GitHub Pages).
 */
export class DocsPreviewStack extends Stack {
  constructor(scope: Construct, id: string, props: DocsPreviewStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'PreviewBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // Sweep up any preview prefixes that outlive their PR (e.g. if a cleanup
      // run was missed) so the bucket does not grow unbounded.
      lifecycleRules: [{ expiration: Duration.days(30) }],
    });

    // Astro builds directory-style routes (e.g. `/guides/` served by
    // `guides/index.html`). Rewrite directory and extensionless requests to the
    // corresponding `index.html` so deep links resolve under each PR prefix.
    const rewriteFunction = new cloudfront.Function(this, 'RewriteFunction', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}
`),
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Nx Plugin for AWS - PR docs previews',
      defaultBehavior: {
        origin:
          origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: rewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // GitHub Actions OIDC provider (created once per account; reuse if present).
    const oidcProvider =
      iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
        this,
        'GitHubOidcProvider',
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
      );

    // The deploy role is assumable only from workflows running on this repo's
    // default branch. The deploy workflow runs via `workflow_run`, so its ref is
    // always `refs/heads/main`.
    const deployRole = new iam.Role(this, 'DeployRole', {
      assumedBy: new iam.WebIdentityPrincipal(
        oidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud':
              'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
          },
        },
      ),
      description:
        'Assumed by GitHub Actions to publish ephemeral PR docs previews',
      maxSessionDuration: Duration.hours(1),
    });

    bucket.grantReadWrite(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    new CfnOutput(this, 'PreviewBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });
    new CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
