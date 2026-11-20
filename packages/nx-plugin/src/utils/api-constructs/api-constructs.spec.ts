/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import { addEcsHttpEndpointConstruct } from './api-constructs.js';

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
