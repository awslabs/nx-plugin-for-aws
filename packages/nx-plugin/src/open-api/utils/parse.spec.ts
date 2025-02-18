/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { parseOpenApiSpec } from './parse';
import type { OpenAPIV3 } from 'openapi-types';

describe('openapi parse utils', () => {
  describe('parseOpenApiSpec', () => {
    let tree: Tree;

    beforeEach(() => {
      tree = createTreeUsingTsSolutionSetup();
    });

    it('should load an openapi spec from the tree', async () => {
      tree.write(
        'spec.yaml',
        `
        openapi: 3.0.3
        info:
          version: 1.0.0
          title: Example API
        paths:
          /hello:
            get:
              responses:
                200:
                  content:
                    application/json:
                      schema:
                        $ref: '#/components/schemas/Response'
        components:
          schemas:
            Response:
              type: object
              properties:
                message:
                  type: string
      `,
      );

      const spec = await parseOpenApiSpec(tree, 'spec.yaml');
      expect(spec.info.title).toBe('Example API');
    });

    it('should load a split file spec from the tree', async () => {
      tree.write(
        'spec.yaml',
        `
        openapi: 3.0.3
        info:
          version: 1.0.0
          title: Example API
        paths:
          /operation:
            post:
              $ref: './operations/op.yaml'
        components:
          schemas:
            $ref: './schemas/index.yaml'
      `,
      );
      tree.write(
        'operations/op.yaml',
        `
        operationId: someOperation
        responses:
          200:
            content:
              application/json:
                schema:
                  $ref: '../spec.yaml#/components/schemas/MyResponse'
      `,
      );
      tree.write(
        'schemas/index.yaml',
        `
        MyResponse:
          $ref: './my-response.yaml'
      `,
      );
      tree.write(
        'schemas/my-response.yaml',
        `
        type: object
        properties:
          message:
            type: string
      `,
      );

      const spec = await parseOpenApiSpec(tree, 'spec.yaml');
      expect(
        (spec as OpenAPIV3.Document).components!.schemas!['MyResponse'],
      ).toEqual({
        type: 'object',
        properties: {
          message: {
            type: 'string',
          },
        },
      });
    });
  });
});
