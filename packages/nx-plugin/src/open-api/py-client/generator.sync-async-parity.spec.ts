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
 * Both clients render from one template, so the text they share cannot drift.
 * What can still diverge is the handful of places the template branches on
 * `isAsync`, so those are asserted directly, per flavour, rather than by
 * comparing the two generated clients to each other.
 */

/** A tagged streaming operation, whose delegate form differs by necessity. */
const TAGGED_STREAM_SPEC: Spec = {
  openapi: '3.1.0',
  info: { title: 'TestApi', version: '1.0.0' },
  paths: {
    '/stream': {
      get: {
        operationId: 'streamIt',
        tags: ['feed'],
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
};

/** A tagged non-streaming operation, whose delegate awaits on the async side. */
const TAGGED_CALL_SPEC: Spec = {
  openapi: '3.0.0',
  info: { title: 'TestApi', version: '1.0.0' },
  paths: {
    '/pets': {
      post: {
        operationId: 'addPet',
        tags: ['pet'],
        responses: { '204': { description: 'No content' } },
      },
    },
  },
};

describe('openApiPyClientGenerator - sync/async flavours', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  // Only these forms propagate closing to the generator that opened the
  // response. `yield from` does so in sync; in async, returning the inner
  // generator does, whereas an `async def` re-yielding from it wraps the
  // generator in a second one `aclose()` never reaches — and the connection
  // then leaks until garbage collection.
  it('delegates a tagged stream so closing it reaches the response', async () => {
    const { client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      TAGGED_STREAM_SPEC,
    );
    expect(client).toContain('    def stream_it(');
    expect(client).toContain('        yield from self._parent._stream_it(');

    expect(asyncClient).toContain('    def stream_it(');
    expect(asyncClient).toContain('        return self._parent._stream_it(');
    expect(asyncClient).not.toContain('    async def stream_it(');
    expect(asyncClient).not.toContain('async for item in self._parent._');
  });

  it('delegates a tagged call by awaiting it on the async client', async () => {
    const { client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      TAGGED_CALL_SPEC,
    );
    expect(client).toContain('    def add_pet(');
    expect(client).toContain('        return self._parent._add_pet(');

    expect(asyncClient).toContain('    async def add_pet(');
    expect(asyncClient).toContain(
      '        return await self._parent._add_pet(',
    );
  });

  // The streamed return type is a different ABC per flavour, not an `Async`
  // spelling of one: only `AsyncGenerator` declares the `aclose()` above.
  it("annotates a stream with the flavour's own iterator type", async () => {
    const { client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      TAGGED_STREAM_SPEC,
    );
    expect(client).toContain('from collections.abc import Iterator');
    expect(client).toContain(') -> Iterator[types.Chunk]:');

    expect(asyncClient).toContain('from collections.abc import AsyncGenerator');
    expect(asyncClient).toContain(') -> AsyncGenerator[types.Chunk]:');
    expect(asyncClient).not.toContain('Iterator[types.Chunk]');
  });

  // Every async keyword and httpx name the template's flavour table maps. A
  // missed entry would emit sync code into the async client, which still parses.
  it('emits the async spelling of every awaited operation', async () => {
    const { client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      PET_STORE_SPEC,
    );

    for (const [sync, async] of [
      ['httpx.Client()', 'httpx.AsyncClient()'],
      ['def __enter__', 'async def __aenter__'],
      ['def __exit__', 'async def __aexit__'],
      ['def close(self)', 'async def aclose(self)'],
      ['self._client.close()', 'await self._client.aclose()'],
    ] as const) {
      expect(client).toContain(sync);
      expect(asyncClient).toContain(async);
    }

    // Neither flavour may carry the other's keywords at all.
    expect(client).not.toContain('await ');
    expect(client).not.toContain('async ');
  });

  // The streaming send block is the one region the flavours iterate differently.
  it("iterates a streamed response with the flavour's own loop", async () => {
    const { client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      TAGGED_STREAM_SPEC,
    );
    expect(client).toContain('with self._client.stream(');
    expect(client).toContain('for chunk in response.iter_text():');

    expect(asyncClient).toContain('async with self._client.stream(');
    expect(asyncClient).toContain('async for chunk in response.aiter_text():');
    expect(asyncClient).not.toContain('for chunk in response.iter_text():');
  });

  it('names the async client and its config after the async flavour', async () => {
    const { client, asyncClient } = await generateAndRead(
      verifier,
      tree,
      TAGGED_CALL_SPEC,
    );
    expect(client).toContain('class TestApi:');
    expect(client).toContain('class TestApiConfig:');
    expect(client).toContain('class _PetNamespace:');

    expect(asyncClient).toContain('class AsyncTestApi:');
    expect(asyncClient).toContain('class AsyncTestApiConfig:');
    expect(asyncClient).toContain('class _AsyncPetNamespace:');
  });
});
