/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { PET_STORE_SPEC } from '../ts-client/petstore-spec';
import {
  createPythonClientVerifier,
  createTree,
  generateAndRead,
} from './generator.utils.spec';

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
    .replace(/\bAsyncGenerator\[/g, 'Iterator[')
    .replace(/\bAsyncClient\b/g, 'Client')
    .replace(/\bAsyncBaseTransport\b/g, 'BaseTransport')
    .replace(/\bcollections\.abc import Generator, Iterator\b/g, 'x')
    // Import lists and blank runs reflow once the above collapses names.
    .replace(/\s+/g, ' ')
    .trim();

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
});
