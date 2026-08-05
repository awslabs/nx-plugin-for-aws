/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const GATEWAY_CONSTRUCT_FILE =
  'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts';

/**
 * The `AgentCoreGateway` core construct's WAF logging block as generated
 * before the log group carried a removal policy, condensed to the shape the
 * migration anchors on.
 */
const OLD_GATEWAY_CONSTRUCT_FILE = `import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export class AgentCoreGateway extends Construct {
  private createWebAcl(metricPrefix: string): wafv2.CfnWebACL {
    const logsKey = new kms.Key(this, 'WebAclLogsKey', {
      enableKeyRotation: true,
    });
    const wafLogGroup = new logs.LogGroup(this, 'WebAclLogs', {
      logGroupName: \`aws-waf-logs-\${metricPrefix}-\${this.node.addr.slice(-8)}\`,
      retention: logs.RetentionDays.ONE_YEAR,
      encryptionKey: logsKey,
    });
    return undefined as any;
  }
}
`;

describe('gateway-waf-log-group-removal migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no gateway construct is vended', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should add a DESTROY removal policy to the WAF log group', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);

    const result = await migration(tree);

    const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain('removalPolicy: cdk.RemovalPolicy.DESTROY');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should be idempotent', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);

    await migration(tree);
    const afterFirst = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toEqual(afterFirst);
    expect(secondRun.nextSteps).toEqual([]);
    // Only one removal policy is present after re-running.
    expect(afterFirst.match(/removalPolicy/g)).toHaveLength(1);
  });

  it('should leave a log group with a user-added removal policy alone', async () => {
    const withRemovalPolicy = OLD_GATEWAY_CONSTRUCT_FILE.replace(
      'encryptionKey: logsKey,',
      'encryptionKey: logsKey,\n      removalPolicy: cdk.RemovalPolicy.RETAIN,',
    );
    tree.write(GATEWAY_CONSTRUCT_FILE, withRemovalPolicy);

    const result = await migration(tree);

    const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain('cdk.RemovalPolicy.RETAIN');
    expect(contents.match(/removalPolicy/g)).toHaveLength(1);
    expect(result.nextSteps).toEqual([]);
  });

  it('should do nothing when the construct has no WAF log group', async () => {
    tree.write(
      GATEWAY_CONSTRUCT_FILE,
      `export class AgentCoreGateway { /* http-only, no web acl */ }`,
    );

    const result = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toContain('http-only');
    expect(result.nextSteps).toEqual([]);
  });
});
