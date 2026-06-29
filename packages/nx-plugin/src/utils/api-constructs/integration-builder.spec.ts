/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createTreeUsingTsSolutionSetup } from '../test';
import { TypeScriptVerifier } from '../test/ts.spec';

/**
 * These tests verify the type-safety of the generated IntegrationBuilder, in particular
 * the interaction between withOperationOptions and withOverrides. The real builder template
 * is compiled with its aws-cdk-lib type imports redirected to a local stub, since the
 * builder's type-safety logic does not depend on those types.
 */
describe('IntegrationBuilder type-safety', () => {
  let tree: Tree;
  const verifier = new TypeScriptVerifier();

  // The real builder template, with aws-cdk-lib type imports redirected to a local stub
  const builderTemplate = readFileSync(
    join(import.meta.dirname, 'files/cdk/core/api/utils/utils.ts.template'),
    'utf-8',
  ).replace(/'aws-cdk-lib[^']*'/g, `'./cdk-stub'`);

  const stub = `
export class Integration {}
export interface MethodOptions {}
export class HttpRouteIntegration {}
export interface AddRoutesOptions {
  path: string;
  methods: string[];
  integration: HttpRouteIntegration;
}
`;

  // Constructs an isolated REST builder with three operations (echo, goodbye, ping)
  const preamble = `
import { IntegrationBuilder, RestApiIntegration } from './utils';
import { Integration } from './cdk-stub';

interface StubProps { timeout?: number; memorySize?: number; }

const integration = (): RestApiIntegration => ({ integration: new Integration() });

export const isolated = () =>
  IntegrationBuilder.rest<'echo' | 'goodbye' | 'ping', StubProps, RestApiIntegration>({
    pattern: 'isolated',
    operations: {
      echo: { path: '/echo', method: 'GET' },
      goodbye: { path: '/goodbye', method: 'GET' },
      ping: { path: '/ping', method: 'GET' },
    },
    defaultIntegrationOptions: {},
    buildDefaultIntegration: () => integration(),
  });

export const shared = () =>
  IntegrationBuilder.rest<'echo' | 'goodbye', StubProps, RestApiIntegration>({
    pattern: 'shared',
    operations: {
      echo: { path: '/echo', method: 'GET' },
      goodbye: { path: '/goodbye', method: 'GET' },
    },
    defaultIntegrationOptions: {},
    buildDefaultIntegration: () => integration(),
  });
`;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write('cdk-stub.ts', stub);
    tree.write('utils.ts', `import './cdk-stub';\n${builderTemplate}`);
  });

  const expectScenario = (chain: string, shouldCompile: boolean) => {
    tree.write('scenario.ts', `${preamble}\nexport const result = ${chain};`);
    const paths = ['cdk-stub.ts', 'utils.ts', 'scenario.ts'];
    if (shouldCompile) {
      verifier.expectTypeScriptToCompile(tree, paths);
    } else {
      expect(() =>
        verifier.expectTypeScriptToCompile(tree, paths, true),
      ).toThrow();
    }
  };

  // Positive cases

  it('should allow per-operation options for a valid operation', () => {
    expectScenario(
      `isolated().withOperationOptions({ echo: { timeout: 60, memorySize: 512 } }).build()`,
      true,
    );
  });

  it('should allow per-operation options for multiple operations at once', () => {
    expectScenario(
      `isolated().withOperationOptions({
        echo: { timeout: 10 },
        goodbye: { memorySize: 256 },
        ping: { timeout: 20, memorySize: 1024 },
      }).build()`,
      true,
    );
  });

  it('should allow tuning a different operation to the one overridden', () => {
    expectScenario(
      `isolated()
        .withOverrides({ echo: { integration: new Integration() } })
        .withOperationOptions({ goodbye: { timeout: 60 } })
        .build()`,
      true,
    );
  });

  it('should allow $router options for the shared pattern', () => {
    expectScenario(
      `shared().withOperationOptions({ $router: { timeout: 60 } }).build()`,
      true,
    );
  });

  // Negative cases

  it('should reject per-operation options for an unknown operation', () => {
    expectScenario(
      `isolated().withOperationOptions({ doesNotExist: { timeout: 60 } }).build()`,
      false,
    );
  });

  it('should reject a per-operation option value of the wrong type', () => {
    expectScenario(
      `isolated().withOperationOptions({ echo: { timeout: 'nope' } }).build()`,
      false,
    );
  });

  it('should reject an unknown per-operation option property', () => {
    expectScenario(
      `isolated().withOperationOptions({ echo: { notARealProp: 1 } }).build()`,
      false,
    );
  });

  it('should reject an operation key for the shared pattern', () => {
    expectScenario(
      `shared().withOperationOptions({ echo: { timeout: 60 } }).build()`,
      false,
    );
  });

  // Negative cases - clashes between withOperationOptions and withOverrides (both orders)

  it('should reject per-operation options for an operation overridden earlier in the chain', () => {
    expectScenario(
      `isolated()
        .withOverrides({ echo: { integration: new Integration() } })
        .withOperationOptions({ echo: { timeout: 60 } })
        .build()`,
      false,
    );
  });

  it('should reject overriding an operation given per-operation options earlier in the chain', () => {
    expectScenario(
      `isolated()
        .withOperationOptions({ echo: { timeout: 60 } })
        .withOverrides({ echo: { integration: new Integration() } })
        .build()`,
      false,
    );
  });
});
