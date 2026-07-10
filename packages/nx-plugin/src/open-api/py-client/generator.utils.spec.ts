/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { openApiPyClientGenerator } from './generator';
import {
  MockEntry,
  PythonVerifier,
  InvokeResult,
  MockResponseSpec,
} from '../../utils/test/py.spec';
import { OpenApiPyClientGeneratorSchema } from './schema';
import { Spec } from '../utils/types';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';

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
 * Paths to the files emitted by the generator for the default `both`
 * `clientType`.  Pass to `expectPythonToCompile`.
 */
export const generatedFilesForSync = [
  `${outputPath}/__init__.py`,
  `${outputPath}/types_gen.py`,
  `${outputPath}/client_gen.py`,
];

export const generatedFilesForAsync = [
  `${outputPath}/__init__.py`,
  `${outputPath}/types_gen.py`,
  `${outputPath}/async_client_gen.py`,
];

/** Files emitted for the default `clientType: 'both'`. */
export const generatedFilesForBoth = [
  `${outputPath}/__init__.py`,
  `${outputPath}/types_gen.py`,
  `${outputPath}/client_gen.py`,
  `${outputPath}/async_client_gen.py`,
];

/**
 * Generate and compile-check a client for the given spec.  Reads the two
 * main artefact files from the tree and returns their text so the caller
 * can snapshot them.
 */
export const generateAndRead = async (
  verifier: PythonVerifier,
  tree: Tree,
  spec: Spec,
  options: Partial<OpenApiPyClientGeneratorSchema> = {},
): Promise<{ types: string; client: string; asyncClient: string }> => {
  tree.write('openapi.json', JSON.stringify(spec));
  await openApiPyClientGenerator(tree, {
    openApiSpecPath: 'openapi.json',
    outputPath,
    ...options,
  });
  const clientType = options.clientType ?? 'both';
  const paths =
    clientType === 'sync'
      ? generatedFilesForSync
      : clientType === 'async'
        ? generatedFilesForAsync
        : generatedFilesForBoth;
  await verifier.expectPythonToCompile(tree, paths, outputPath);
  return {
    types: tree.read(`${outputPath}/types_gen.py`, 'utf-8') ?? '',
    client: tree.read(`${outputPath}/client_gen.py`, 'utf-8') ?? '',
    asyncClient: tree.read(`${outputPath}/async_client_gen.py`, 'utf-8') ?? '',
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
): Promise<InvokeResult> =>
  verifier.invoke({
    module: 'sync',
    method: op,
    args,
    kwargs,
    mock: normaliseMock(mock),
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
 * Create a fresh empty nx workspace tree.  Re-exported so topic files can
 * import one thing from `generator.utils.spec`.
 */
export const createTree = (): Tree => createTreeUsingTsSolutionSetup();

describe('openapi py-client test utils', () => {
  it('has a test so vitest picks this file up as a spec', () => {
    // Intentionally empty — utilities only.
  });
});
