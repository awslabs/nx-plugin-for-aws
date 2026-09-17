/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec.js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { openApiTsClientGenerator } from './generator.js';
import { PET_STORE_SPEC } from './petstore-spec.js';

describe('openApiTsClientGenerator - petstore', () => {
  let tree: Tree;
  const title = 'TestApi';

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const validateTypeScript = (paths: string[]) => {
    expectTypeScriptToCompile(tree, paths);
  };

  it('should generate valid code for the petstore example ', async () => {
    tree.write('openapi.json', JSON.stringify(PET_STORE_SPEC));

    await openApiTsClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });

    validateTypeScript([
      'src/generated/client.gen.ts',
      'src/generated/types.gen.ts',
    ]);
  });
});
