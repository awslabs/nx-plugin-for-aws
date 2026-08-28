/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { Spec } from '../utils/types.js';
import {
  callGeneratedClient,
  callGeneratedClientStreaming,
  createPythonClientVerifier,
  createTree,
  expectSingleRequest,
  generateAndRead,
  generatedPythonFiles,
  outputPath,
} from './generator.utils.spec.js';
import vesselRegistrySpec from './vessel-registry-spec.json' with {
  type: 'json',
};

/**
 * A whole document as FastAPI actually emits one: 20 operations, 37 schemas,
 * tag namespaces, JSON-lines streaming, 204s, required headers, repeatable list
 * query parameters and — the shape every hand-written fixture here missed —
 * optional parameters written as an OpenAPI 3.1 `anyOf: [T, null]` carrying a
 * `description`.
 *
 * The hand-written specs each probe one construct, which leaves combinations
 * unexercised: no fixture produced a documented module-level alias at all, so
 * the emission path that once ran a docstring onto its alias (making the module
 * unparseable) had no coverage. A realistic document is the cheapest way to keep
 * that class of gap closed.
 */
const spec = vesselRegistrySpec as unknown as Spec;

describe('openApiPyClientGenerator - a real FastAPI document', () => {
  let tree: Tree;
  const verifier = createPythonClientVerifier();

  beforeEach(() => {
    tree = createTree();
  });

  // `generateAndRead` compiles, imports and type checks every emitted module, so
  // this alone fails on anything that does not parse.
  it.each(['both', 'sync', 'async'] as const)(
    'emits importable modules for clientType %s',
    async (clientType) => {
      await generateAndRead(verifier, tree, spec, { clientType });
      expect(generatedPythonFiles(tree).length).toBeGreaterThan(3);
    },
  );

  // The defect this document surfaced: a documented optional parameter becomes a
  // module-level alias, and its docstring belongs on the following line.
  it('puts every alias docstring on its own line', async () => {
    const { types } = await generateAndRead(verifier, tree, spec);
    // `Alias = type"""doc"""` — a statement and a string with nothing between.
    expect(types).not.toMatch(/^[A-Za-z_]\w* = .*"""/m);
    // The same slurped whitespace also ate the space after `=`.
    expect(types).not.toMatch(/^[A-Za-z_]\w* =\S/m);
    // The aliases are still documented, on their own line.
    expect(types).toMatch(
      /^GetVesselRequestQueryAsOf = datetime\.datetime \| None\n"""/m,
    );
  });

  it('exposes every operation under its tag namespace', async () => {
    const { client } = await generateAndRead(verifier, tree, spec);
    for (const namespace of [
      'self.fleet',
      'self.ports',
      'self.manifests',
      'self.lanes',
      'self.crew',
    ]) {
      expect(client).toContain(namespace);
    }
  });

  it('sends a repeatable list query parameter once per value', async () => {
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'fleet.list_vessels',
      { hull_class: ['skiff', 'hauler'], status: ['berthed'] },
      { json: { vessels: [], total_matched: 0, next_cursor: null } },
    );
    expect(res.ok).toBe(true);
    const query = new URL(expectSingleRequest(res).url).searchParams;
    expect(query.getAll('hull_class')).toEqual(['skiff', 'hauler']);
    expect(query.getAll('status')).toEqual(['berthed']);
  });

  it('requires a mandatory header parameter as a keyword argument', async () => {
    await generateAndRead(verifier, tree, spec);
    const missing = await callGeneratedClient(
      verifier,
      'fleet.update_vessel_status',
      { vessel_id: 'ves_1', status: 'berthed' },
      { json: { vessel_id: 'ves_1', status: 'berthed' } },
    );
    // The header has no default, so omitting it is a TypeError rather than a
    // request that reaches the server without it.
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/x_dock_authority/);
  });

  it('parses a JSON-lines stream into typed frames', async () => {
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClientStreaming(
      verifier,
      'fleet.stream_vessel_telemetry',
      { vessel_id: 'ves_1', frames: 2 },
      {
        status: 200,
        jsonl_lines: [0, 1].map((sequence) =>
          JSON.stringify({
            vessel_id: 'ves_1',
            sequence,
            captured_at: '2026-09-01T00:00:00Z',
            hull_temp_kelvin: 290.5,
            reactor_output_mw: 12.25,
            drift_metres_per_second: 0.5,
          }),
        ),
        // Small enough that a frame spans two chunks, exercising the buffering.
        chunk_size: 31,
      },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toHaveLength(2);
    expect((res.value as { sequence: number }[])[1].sequence).toBe(1);
  });

  it('returns None from a 204 operation', async () => {
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'fleet.decommission_vessel',
      { vessel_id: 'ves_1' },
      { status: 204 },
    );
    expect(res.ok).toBe(true);
    expect(res.value).toBeNull();
  });

  it('raises the per-operation typed error for a declared 404', async () => {
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'fleet.get_vessel',
      { vessel_id: 'ves_nope' },
      { status: 404, json: { detail: 'No vessel registered as ves_nope' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.type).toBe('GetVesselApiError');
    expect(res.exception?.error_type).toBe('GetVessel404Error');
    expect(res.exception?.status).toBe(404);
  });

  // An undeclared status still raises the operation's own exception with the
  // right status. The operation declares no `default`, so there is no model to
  // coerce the body into and `error` is left unset — the payload is not invented.
  it('raises without a payload for an undeclared status', async () => {
    await generateAndRead(verifier, tree, spec);
    const res = await callGeneratedClient(
      verifier,
      'fleet.get_vessel',
      { vessel_id: 'ves_1' },
      { status: 409, json: { detail: 'conflict' } },
    );
    expect(res.ok).toBe(false);
    expect(res.exception?.type).toBe('GetVesselApiError');
    expect(res.exception?.status).toBe(409);
    expect(res.exception?.error).toBeUndefined();
  });

  it('emits the same module set for the async client', async () => {
    await generateAndRead(verifier, tree, spec, { clientType: 'async' });
    expect(tree.children(outputPath).sort()).toEqual([
      '__init__.py',
      'async_client.py',
      'errors.py',
      'types.py',
    ]);
  });
});
