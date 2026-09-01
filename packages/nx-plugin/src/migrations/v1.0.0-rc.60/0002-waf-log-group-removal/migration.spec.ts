/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const GATEWAY_CONSTRUCT_FILE =
  'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts';

const REST_API_CONSTRUCT_FILE =
  'packages/common/constructs/src/core/api/rest-api.ts';

/**
 * The `AgentCoreGateway` core construct's WAF logging block as generated
 * before the log group carried a removal policy, condensed to the shape the
 * migration anchors on. `cdk` is namespaced, `LogGroup` is via `logs.`.
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

/**
 * The `RestApi` core construct's WAF logging block as generated before the log
 * group carried a removal policy. `LogGroup` and `RemovalPolicy` are
 * destructured — `RemovalPolicy` is not yet imported, so the migration must
 * add it.
 */
const OLD_REST_API_CONSTRUCT_FILE = `import { IAspect, Stack } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Key } from 'aws-cdk-lib/aws-kms';
import { CfnLoggingConfiguration } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export class RestApi extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    const logsKey = new Key(this, 'WebAclLogsKey', { enableKeyRotation: true });
    // The construct has another log group sharing the encryptionKey shape, so
    // the migration must scope its rewrite to the WAF log group only.
    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: RetentionDays.ONE_YEAR,
      encryptionKey: logsKey,
    });
    const wafLogGroup = new LogGroup(this, 'WebAclLogs', {
      logGroupName: \`aws-waf-logs-\${apiName}-\${this.node.addr.slice(-8)}\`,
      retention: RetentionDays.ONE_YEAR,
      encryptionKey: logsKey,
    });
  }
}
`;

describe('waf-log-group-removal migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no constructs are vended', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should add a DESTROY removal policy to the gateway WAF log group', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);

    const result = await migration(tree);

    const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain('removalPolicy: cdk.RemovalPolicy.DESTROY');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should add a DESTROY removal policy and import to the rest api WAF log group', async () => {
    tree.write(REST_API_CONSTRUCT_FILE, OLD_REST_API_CONSTRUCT_FILE);

    const result = await migration(tree);

    const contents = tree.read(REST_API_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain('removalPolicy: RemovalPolicy.DESTROY');
    // The migration adds RemovalPolicy to the existing aws-cdk-lib import.
    expect(contents).toMatch(
      /import \{[^}]*RemovalPolicy[^}]*\} from 'aws-cdk-lib'/,
    );
    // Only the WAF log group gets the policy — the access log group is left
    // alone despite sharing the encryptionKey shape.
    expect(contents.match(/removalPolicy/g)).toHaveLength(1);
    // The GritQL placeholder must not leak into the output.
    expect(contents).not.toContain('GRIT_INSERT_PLACEHOLDER');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should migrate both constructs when both are present', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);
    tree.write(REST_API_CONSTRUCT_FILE, OLD_REST_API_CONSTRUCT_FILE);

    const result = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toContain(
      'removalPolicy: cdk.RemovalPolicy.DESTROY',
    );
    expect(tree.read(REST_API_CONSTRUCT_FILE, 'utf-8')).toContain(
      'removalPolicy: RemovalPolicy.DESTROY',
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);
    tree.write(REST_API_CONSTRUCT_FILE, OLD_REST_API_CONSTRUCT_FILE);

    await migration(tree);
    const gatewayAfterFirst = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    const restApiAfterFirst = tree.read(REST_API_CONSTRUCT_FILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toEqual(
      gatewayAfterFirst,
    );
    expect(tree.read(REST_API_CONSTRUCT_FILE, 'utf-8')).toEqual(
      restApiAfterFirst,
    );
    expect(secondRun.nextSteps).toEqual([]);
    expect(gatewayAfterFirst.match(/removalPolicy/g)).toHaveLength(1);
    expect(restApiAfterFirst.match(/removalPolicy/g)).toHaveLength(1);
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
