/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
// The declaration a real caller passes: `addApiGatewayInfra` adds the packages
// the constructs it vends import, and only a caller that declares them may ask.
import { DEPENDENCIES } from '../../trpc/backend/generator.js';
import {
  CONTAINER_HEALTH_CHECK_PATH,
  CONTAINER_PORT,
} from '../container-constructs/container-constructs.js';
import type { Iac } from '../iac.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import {
  type AddApiGatewayConstructOptions,
  addApiGatewayInfra,
  addEcsHttpEndpointConstruct,
} from './api-constructs.js';

const ENDPOINT_PATH =
  'packages/common/constructs/src/core/api/ecs-http-endpoint.ts';

describe('addEcsHttpEndpointConstruct', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should vend the endpoint construct on its own', () => {
    addEcsHttpEndpointConstruct(tree);

    const endpoint = tree.read(ENDPOINT_PATH, 'utf-8');
    expect(endpoint).toContain('export class EcsHttpEndpoint');
    // A generator that puts an HTTP endpoint in front of a container service
    // without an API Gateway in front of that gets the construct and nothing
    // else: no core HTTP API construct, and no per-API construct.
    expect(
      tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
    ).toBe(false);
    expect(tree.exists('packages/common/constructs/src/app/apis')).toBe(false);
  });

  it('should write ESM import specifiers in an ESM workspace', () => {
    addEcsHttpEndpointConstruct(tree);

    expect(tree.read(ENDPOINT_PATH, 'utf-8')).toContain("from '../checkov.js'");
  });

  it('should write CommonJS import specifiers in a CommonJS workspace', () => {
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      type: 'commonjs',
    }));

    addEcsHttpEndpointConstruct(tree);

    expect(tree.read(ENDPOINT_PATH, 'utf-8')).toContain("from '../checkov'");
  });

  it('should leave a user edit alone on a second call', () => {
    addEcsHttpEndpointConstruct(tree);
    tree.write(ENDPOINT_PATH, '// MY ENDPOINT\n');

    addEcsHttpEndpointConstruct(tree);

    expect(tree.read(ENDPOINT_PATH, 'utf-8')).toBe('// MY ENDPOINT\n');
  });
});

// The combinations this rejects. The combination it accepts, cdk with ecs
// options, is what every `infra=http-ecs` case in
// `src/trpc/backend/generator.spec.ts` and `http-ecs-constructs.spec.ts` runs.
describe('addApiGatewayInfra', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  /** What a generator asking for an HTTP API in front of a container passes. */
  const httpEcsOptions = (
    overrides: Partial<AddApiGatewayConstructOptions & { iac: Iac }> = {},
  ): AddApiGatewayConstructOptions & { iac: Iac } => ({
    apiProjectName: '@proj/test-api',
    apiNameClassName: 'TestApi',
    apiNameKebabCase: 'test-api',
    constructType: 'http-ecs',
    backend: {
      type: 'trpc',
      integrationPattern: 'shared',
      projectAlias: '@proj/test-api',
      projectRoot: 'apps/test-api',
      bundleOutputDir: 'dist/apps/test-api/bundle',
    },
    auth: 'iam',
    ecs: {
      serviceClassName: 'TestApiContainer',
      serviceFileKebabCase: 'test-api-container',
      containerPort: CONTAINER_PORT,
      healthCheckPath: CONTAINER_HEALTH_CHECK_PATH,
    },
    iac: 'cdk',
    ...overrides,
  });

  // Only the CDK provider vends the load balancer, VPC link and target group
  // the container service sits behind, so a Terraform caller is told which
  // infra options it does have rather than receiving a half-wired workspace.
  it('should reject http-ecs on terraform', async () => {
    await expect(
      addApiGatewayInfra(
        tree,
        httpEcsOptions({ iac: 'terraform' }),
        DEPENDENCIES,
      ),
    ).rejects.toThrow(
      `infra 'http-ecs' is only implemented for the cdk IaC provider. Pass --iac=cdk, or choose rest-lambda or http-lambda for terraform.`,
    );

    // Rejected before anything is written, so the caller's tree is untouched.
    expect(tree.exists('packages/common/terraform')).toBe(false);
    expect(tree.exists('packages/common/constructs/src/app/apis')).toBe(false);
  });

  // The API construct routes to a named service on a named port, so there is
  // nothing to generate without those names.
  it('should reject http-ecs without the ecs options', async () => {
    await expect(
      addApiGatewayInfra(
        tree,
        httpEcsOptions({ ecs: undefined }),
        DEPENDENCIES,
      ),
    ).rejects.toThrow(`constructType 'http-ecs' requires ecs options`);

    expect(tree.exists('packages/common/constructs/src/app/apis')).toBe(false);
    expect(tree.exists(ENDPOINT_PATH)).toBe(false);
  });
});
