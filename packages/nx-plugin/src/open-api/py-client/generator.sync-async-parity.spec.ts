/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { PET_STORE_SPEC } from '../ts-client/petstore-spec.js';
import type { Spec } from '../utils/types.js';
import {
  createPythonClientVerifier,
  createTree,
  generateAndRead,
} from './generator.utils.spec.js';

/**
 * The sync and async clients are rendered by two templates that differ only in
 * how they await. Normalising that difference away should leave the same text,
 * so anything else that diverges is drift — and drift is how a fix applied to
 * one client but not the other survives (a tagged async stream once failed to
 * forward `aclose()` while its sync counterpart was correct).
 */
const normalise = (source: string): string =>
  source
    // The async client's own names and the keywords that make it async.
    .replace(/\b_Async([A-Z])/g, '_$1')
    .replace(/\bAsync([A-Z])/g, '$1')
    .replace(/\b__aenter__\b/g, '__enter__')
    .replace(/\b__aexit__\b/g, '__exit__')
    .replace(/\basync def\b/g, 'def')
    .replace(/\basync with\b/g, 'with')
    .replace(/\basync for\b/g, 'for')
    .replace(/\bawait /g, '')
    .replace(/\basynchronous\b/gi, (m) =>
      m[0] === 'A' ? 'Synchronous' : 'synchronous',
    )
    .replace(/\basynccontextmanager\b/g, 'contextmanager')
    // httpx and typing spell their async counterparts differently.
    .replace(/\baclose\b/g, 'close')
    .replace(/\baiter_lines\b/g, 'iter_lines')
    .replace(/\baiter_text\b/g, 'iter_text')
    .replace(/\baiter_bytes\b/g, 'iter_bytes')
    .replace(/\baread\b/g, 'read')
    .replace(/\bAsyncIterator\b/g, 'Iterator')
    .replace(/\bAsyncGenerator\b/g, 'Generator')
    .replace(/\bAsyncClient\b/g, 'Client')
    .replace(/\bAsyncBaseTransport\b/g, 'BaseTransport')
    // A sync stream is an `Iterator`; its async counterpart is a `Generator`,
    // which additionally declares the `aclose()` an early-stopping caller needs.
    .replace(/\bGenerator\b/g, 'Iterator')
    // Whichever of the two the module imports, the import line collapses to one
    // form once the names above do.
    .replace(
      /from collections\.abc import [A-Za-z, ]+/g,
      'from collections.abc import Iterator',
    )
    // A tag namespace delegates a stream differently by necessity: `yield from`
    // propagates `close()` into the inner generator, while its async equivalent
    // returns that generator so `aclose()` reaches it (re-yielding would not).
    .replace(/\byield from (self\._parent\._)/g, 'return $1')
    // Import lists and blank runs reflow once the above collapses names.
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Shapes the petstore doesn't reach, each exercising a branch that exists once
 * per template — so a branch edited on one side only is caught here.
 */
const BRANCH_SPECS: Record<string, Spec> = {
  'whole-body multipart': {
    openapi: '3.0.0',
    info: { title: 'TestApi', version: '1.0.0' },
    paths: {
      '/upload': {
        post: {
          operationId: 'upload',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          responses: { '204': { description: 'No content' } },
        },
      },
    },
  },
  'urlencoded and binary bodies': {
    openapi: '3.0.0',
    info: { title: 'TestApi', version: '1.0.0' },
    paths: {
      '/form': {
        post: {
          operationId: 'postForm',
          requestBody: {
            required: true,
            content: {
              'application/x-www-form-urlencoded': {
                schema: {
                  type: 'object',
                  required: ['a'],
                  properties: { a: { type: 'string' } },
                },
              },
            },
          },
          responses: { '204': { description: 'No content' } },
        },
      },
      '/raw': {
        post: {
          operationId: 'postRaw',
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          responses: { '204': { description: 'No content' } },
        },
      },
      '/text': {
        post: {
          operationId: 'postText',
          requestBody: {
            required: true,
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
          responses: { '204': { description: 'No content' } },
        },
      },
    },
  },
  'tagged streaming and allowReserved': {
    openapi: '3.1.0',
    info: { title: 'TestApi', version: '1.0.0' },
    paths: {
      '/stream': {
        get: {
          operationId: 'streamIt',
          tags: ['feed'],
          parameters: [
            {
              name: 'q',
              in: 'query',
              allowReserved: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'stream',
              content: {
                'application/jsonl': {
                  schema: { $ref: '#/components/schemas/Chunk' },
                  itemSchema: { $ref: '#/components/schemas/Chunk' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Chunk: {
          type: 'object',
          required: ['content'],
          properties: { content: { type: 'string' } },
        },
      },
    },
  },
  'void stream, cookies and wildcard errors': {
    openapi: '3.0.0',
    info: { title: 'TestApi', version: '1.0.0' },
    paths: {
      '/events': {
        get: {
          operationId: 'events',
          'x-streaming': true,
          parameters: [
            { name: 'session', in: 'cookie', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'stream' },
            '5XX': { description: 'Boom' },
            default: { description: 'Other' },
          },
        },
      },
    },
  },
};

describe('openApiPyClientGenerator - sync/async parity', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  it('renders the same client for sync and async, modulo async keywords', async () => {
    const { client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      PET_STORE_SPEC,
    );
    expect(normalise(asyncClient)).toBe(normalise(client));
  });

  // The petstore leaves several per-flavour branches unrendered, and a branch no
  // spec renders is a branch this test cannot compare.
  it.each(Object.keys(BRANCH_SPECS))(
    'renders the same client for sync and async given %s',
    async (name) => {
      const { client, asyncClient } = await generateAndRead(
        verifier,
        tree,
        BRANCH_SPECS[name],
      );
      expect(normalise(asyncClient)).toBe(normalise(client));
    },
  );
});
