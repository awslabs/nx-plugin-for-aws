/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  type InvokeResult,
  type MockEntry,
  type MockResponseSpec,
  PythonVerifier,
} from '../../utils/test/py.spec';
import { PY_CLIENT_VERIFIER_DEPENDENCIES } from '../../utils/test/python-dependencies';
import type { Spec } from '../utils/types';
import { openApiPyClientGenerator } from './generator';
import type { OpenApiPyClientGeneratorSchema } from './schema';

/**
 * A verifier carrying the dependencies a generated client imports, started
 * before the suite and shut down after it.
 *
 * Every py-client spec needs the same one, so the lifecycle lives here rather
 * than being repeated. The worker is long-lived: it is reused across the
 * suite's tests and torn down once.
 */
export const createPythonClientVerifier = (): PythonVerifier => {
  const verifier = new PythonVerifier(PY_CLIENT_VERIFIER_DEPENDENCIES);
  afterAll(async () => {
    await verifier.shutdown();
  });
  return verifier;
};

/**
 * Base URL the generated client points at inside tests — the mock transport
 * doesn't actually dial anywhere so this is decorative.
 */
export const baseUrl = 'https://example.com';

/**
 * Default output directory used by every test.  Matches the ts-client layout
 * (`src/generated/*`) so snapshots read consistently.
 */
export const outputPath = 'src/generated';

/**
 * Every Python file the generator emitted, so a test compiles whatever the
 * generator actually produced rather than a list that can fall out of date.
 */
export const generatedPythonFiles = (
  tree: Tree,
  dir: string = outputPath,
): string[] =>
  tree
    .children(dir)
    .filter((child) => child.endsWith('.py'))
    .map((child) => `${dir}/${child}`)
    .sort();

/**
 * Generate and compile-check a client for the given spec, returning the text of
 * each emitted module so the caller can snapshot or assert on it.
 */
export const generateAndRead = async (
  verifier: PythonVerifier,
  tree: Tree,
  spec: Spec,
  options: Partial<OpenApiPyClientGeneratorSchema> = {},
): Promise<{
  types: string;
  client: string;
  asyncClient: string;
  errors: string;
  init: string;
}> => {
  tree.write('openapi.json', JSON.stringify(spec));
  await openApiPyClientGenerator(tree, {
    openApiSpecPath: 'openapi.json',
    outputPath,
    ...options,
  });
  await verifier.expectPythonToCompile(
    tree,
    generatedPythonFiles(tree),
    outputPath,
  );
  const read = (file: string) =>
    tree.read(`${outputPath}/${file}`, 'utf-8') ?? '';
  return {
    types: read('types.py'),
    client: read('client.py'),
    asyncClient: read('async_client.py'),
    errors: read('errors.py'),
    init: read('__init__.py'),
  };
};

/**
 * Call a method on the synchronously-generated client, mirroring
 * `callGeneratedClient` on the ts-client side.  The generated code talks to
 * a `httpx.MockTransport` in the worker which replays the given mock entries.
 */
export const callGeneratedClient = async (
  verifier: PythonVerifier,
  op: string,
  kwargs: Record<string, unknown>,
  mock: MockResponseSpec | MockEntry[],
  args: unknown[] = [],
  /** Extra kwargs for the generated client's own Config dataclass. */
  configKwargs: Record<string, unknown> = {},
): Promise<InvokeResult> =>
  verifier.invoke({
    module: 'sync',
    method: op,
    args,
    kwargs,
    mock: normaliseMock(mock),
    clientKwargs: configKwargs,
  });

/** Async variant of `callGeneratedClient`. */
export const callGeneratedClientAsync = async (
  verifier: PythonVerifier,
  op: string,
  kwargs: Record<string, unknown>,
  mock: MockResponseSpec | MockEntry[],
  args: unknown[] = [],
): Promise<InvokeResult> =>
  verifier.invoke({
    module: 'async',
    method: op,
    args,
    kwargs,
    mock: normaliseMock(mock),
  });

/** Call a streaming generator method and collect all yielded items. */
export const callGeneratedClientStreaming = async (
  verifier: PythonVerifier,
  op: string,
  kwargs: Record<string, unknown>,
  mock: MockResponseSpec | MockEntry[],
): Promise<InvokeResult> =>
  verifier.invoke({
    module: 'sync',
    method: op,
    stream: true,
    kwargs,
    mock: normaliseMock(mock),
  });

export const callGeneratedClientStreamingAsync = async (
  verifier: PythonVerifier,
  op: string,
  kwargs: Record<string, unknown>,
  mock: MockResponseSpec | MockEntry[],
): Promise<InvokeResult> =>
  verifier.invoke({
    module: 'async',
    method: op,
    stream: true,
    kwargs,
    mock: normaliseMock(mock),
  });

/** Accept either a single response spec (catch-all) or an array of mocks. */
const normaliseMock = (mock: MockResponseSpec | MockEntry[]): MockEntry[] =>
  Array.isArray(mock) ? mock : [{ response: mock }];

/** Build a mock entry that returns a jsonl body. */
export const mockJsonlResponse = (
  status: number,
  jsonlLines: string[],
): MockResponseSpec => ({
  status,
  jsonl_lines: jsonlLines,
});

/**
 * The single request the client made, failing with the recorded calls when the
 * count isn't one. Asserting on the request is how a test pins the wire form
 * the client produced rather than only what it returned.
 */
export const expectSingleRequest = (
  result: InvokeResult,
): NonNullable<InvokeResult['calls']>[number] => {
  const calls = result.calls ?? [];
  if (calls.length !== 1) {
    throw new Error(
      `expected exactly one request, got ${calls.length}: ${JSON.stringify(calls, null, 2)}` +
        (result.ok
          ? ''
          : `\nclient error: ${result.error}\n${result.traceback}`),
    );
  }
  return calls[0];
};

/** Assert the client called the expected HTTP method and path. */
export const expectRequestTarget = (
  result: InvokeResult,
  method: string,
  path: string,
): void => {
  const call = expectSingleRequest(result);
  expect(call.method).toBe(method);
  expect(new URL(call.url).pathname).toBe(path);
};

/** The parsed JSON request body of the single request the client made. */
export const requestJsonBody = (result: InvokeResult): unknown => {
  const { body } = expectSingleRequest(result);
  return body === null ? null : JSON.parse(body);
};

/** The query string of the single request the client made, without the `?`. */
export const requestQuery = (result: InvokeResult): string =>
  new URL(expectSingleRequest(result).url).search.replace(/^\?/, '');

/**
 * Create a fresh empty nx workspace tree.  Re-exported so topic files can
 * import one thing from `generator.utils.spec`.
 */
export const createTree = (): Tree => createTreeUsingTsSolutionSetup();

describe('openapi py-client test utils', () => {
  it('has a test so vitest picks this file up as a spec', () => {
    // Intentionally empty — utilities only.
  });
});
