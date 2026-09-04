/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const GATEWAY_CONSTRUCT_FILE =
  'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts';

const APP_GATEWAY_CONSTRUCT_FILE =
  'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts';

/**
 * The `AgentCoreGateway` core construct as generated prior to the `gatewayUrl`
 * accessor, condensed to the shapes the migration anchors on: the
 * `grantPrincipal` accessor it is inserted before, and `addGateway` with its
 * inline CloudFormation-attribute fallback.
 */
const OLD_GATEWAY_CONSTRUCT_FILE = `import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class AgentCoreGateway extends Construct implements iam.IGrantable {
  public readonly gateway: agentcore.Gateway;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.gateway = undefined as any;
  }

  /**
   * The principal to grant permissions to.
   */
  public get grantPrincipal(): iam.IPrincipal {
    return this.gateway.role.grantPrincipal;
  }

  public addGateway(
    gateway: Construct & {
      readonly gateway: agentcore.Gateway;
      readonly gatewayName: string;
    },
    props?: {
      gatewayTargetName?: string;
    },
  ): agentcore.CfnGatewayTarget {
    const target = this.addGatewayTarget({
      gatewayTargetName: props?.gatewayTargetName ?? gateway.gatewayName,
      // The Gateway L2 only populates gatewayUrl when created from its own
      // props; fall back to the CloudFormation attribute otherwise.
      gatewayUrl:
        gateway.gateway.gatewayUrl ??
        (gateway.gateway.node.defaultChild as agentcore.CfnGateway)
          .attrGatewayUrl,
      gatewayArn: gateway.gateway.gatewayArn,
    });
    target.node.addDependency(gateway);
    return target;
  }

  public addGatewayTarget(props: {
    gatewayTargetName: string;
    gatewayUrl: string;
    gatewayArn: string;
  }): agentcore.CfnGatewayTarget {
    return undefined as any;
  }
}
`;

/**
 * A vended app-level gateway construct as generated prior to the accessor,
 * condensed to its runtime config registration.
 */
const OLD_APP_GATEWAY_CONSTRUCT_FILE = `import { Construct } from 'constructs';
import { AgentCoreGateway } from '../../../core/agentcore-gateway/agentcore-gateway';
import { RuntimeConfig } from '../../../core/runtime-config';

export class MyGateway extends AgentCoreGateway {
  public readonly gatewayName = 'my-gateway';

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const rc = RuntimeConfig.ensure(this);
    rc.set('agentcore', 'gateways', {
      ...rc.get('agentcore').gateways,
      MyGateway: this.gateway.gatewayUrl,
    });
  }
}
`;

describe('gateway-url-accessor migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no gateway constructs are vended', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should add the gatewayUrl accessor to the vended core construct', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);

    const result = await migration(tree);

    const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain('public get gatewayUrl(): string {');
    expect(contents).toContain('.attrGatewayUrl');
    // addGateway reads the accessor rather than repeating the fallback.
    expect(contents).toContain('gatewayUrl: gateway.gatewayUrl,');
    expect(contents).not.toContain('gateway.gateway.gatewayUrl ??');
    // The accessor is part of the shape addGateway requires.
    expect(contents).toContain('readonly gatewayUrl: string;');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should point vended app-level gateway constructs at the accessor', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);
    tree.write(APP_GATEWAY_CONSTRUCT_FILE, OLD_APP_GATEWAY_CONSTRUCT_FILE);

    await migration(tree);

    const contents = tree.read(APP_GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain('MyGateway: this.gatewayUrl,');
    expect(contents).not.toContain('this.gateway.gatewayUrl');
    expect(contents).toMatchSnapshot();
  });

  it('should preserve user code around the accessor', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);
    tree.write(APP_GATEWAY_CONSTRUCT_FILE, OLD_APP_GATEWAY_CONSTRUCT_FILE);

    await migration(tree);

    // User-authored additions between the two runs must survive the second.
    tree.write(
      APP_GATEWAY_CONSTRUCT_FILE,
      tree.read(APP_GATEWAY_CONSTRUCT_FILE, 'utf-8').replace(
        "public readonly gatewayName = 'my-gateway';",
        `public readonly gatewayName = 'my-gateway';

  /** My own helper. */
  public get myCustomUrl(): string {
    return \`\${this.gatewayUrl}/custom\`;
  }`,
      ),
    );

    await migration(tree);

    const contents = tree.read(APP_GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain('My own helper.');
    expect(contents).toContain('public get myCustomUrl(): string {');
    expect(contents).toContain('MyGateway: this.gatewayUrl,');
  });

  it('should be idempotent', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);
    tree.write(APP_GATEWAY_CONSTRUCT_FILE, OLD_APP_GATEWAY_CONSTRUCT_FILE);

    await migration(tree);
    const coreAfterFirst = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    const appAfterFirst = tree.read(APP_GATEWAY_CONSTRUCT_FILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toEqual(coreAfterFirst);
    expect(tree.read(APP_GATEWAY_CONSTRUCT_FILE, 'utf-8')).toEqual(
      appAfterFirst,
    );
    expect(secondRun.nextSteps).toEqual([]);
  });

  it('should skip and report a diverged core construct', async () => {
    tree.write(
      GATEWAY_CONSTRUCT_FILE,
      `export class AgentCoreGateway { /* fully customised */ }`,
    );

    const result = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toContain(
      'fully customised',
    );
    expect(result.nextSteps).toEqual([
      expect.stringContaining('diverged from the generated shape'),
    ]);
  });

  it('should leave a construct with a user-added gatewayUrl accessor alone', async () => {
    tree.write(
      GATEWAY_CONSTRUCT_FILE,
      OLD_GATEWAY_CONSTRUCT_FILE.replace(
        '  /**\n   * The principal to grant permissions to.\n   */',
        `  public get gatewayUrl(): string {
    return 'https://my-own-url';
  }

  /**
   * The principal to grant permissions to.
   */`,
      ),
    );

    const result = await migration(tree);

    const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain("'https://my-own-url'");
    expect(contents.match(/public get gatewayUrl/g)).toHaveLength(1);
    expect(result.nextSteps).toEqual([]);
  });
});
