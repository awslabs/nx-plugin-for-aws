/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'fs';
import * as path from 'path';
import { PYTHON_CLIENT_MEMBERS } from '../utils/codegen-data.js';

/**
 * One template renders both clients, so a flavour difference is expressed once —
 * in the preamble's flavour table — rather than by editing two files. These
 * assertions keep it that way: they fail if a new difference is written inline in
 * the Python body, which is how the duplication would grow back.
 */
const TEMPLATE = path.join(
  import.meta.dirname,
  'files',
  'client',
  '__clientModuleName__.py.template',
);

const source = fs.readFileSync(TEMPLATE, 'utf-8');
const lines = source.split('\n');
/** The JS preamble ends at its closing `_%>`; the Python body follows. */
const preambleEnd = lines.findIndex((line) => line.trim() === '_%>');
const preamble = lines.slice(0, preambleEnd + 1).join('\n');
const body = lines.slice(preambleEnd + 1).join('\n');

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe('openApiPyClientGenerator - client template invariants', () => {
  it('is the only client template', () => {
    const files = path.join(import.meta.dirname, 'files');
    expect(fs.readdirSync(files).sort()).toEqual(['client', 'shared']);
    expect(fs.readdirSync(path.dirname(TEMPLATE))).toEqual([
      '__clientModuleName__.py.template',
    ]);
  });

  // The filename carries the flavour, which is what lets one source emit both
  // modules — `generateFiles` substitutes `__clientModuleName__` from the context.
  it('names the emitted module from the context', () => {
    expect(path.basename(TEMPLATE)).toBe('__clientModuleName__.py.template');
  });

  it('derives every flavour difference once, in the preamble', () => {
    // Each of these is the single definition of one axis of variation.
    for (const definition of [
      'const kw = isAsync',
      'const hx = isAsync',
      'const enterName = isAsync',
      'const exitName = isAsync',
      'const contextManager = isAsync',
      'const asyncPrefix = isAsync',
    ]) {
      expect(occurrences(preamble, definition)).toBe(1);
    }
  });

  // A `yield from` in the async client would be a syntax error, and an `await`
  // in the sync one would not parse either, so both spellings must come from the
  // table rather than being written into the body.
  it('leaves the async keywords out of the Python body', () => {
    for (const keyword of [
      'async def ',
      'async with ',
      'async for ',
      'await self.',
      'await response.',
      '.aclose()',
      '.aiter_text()',
      '.aiter_lines()',
      '.aread()',
      'httpx.AsyncClient',
      'asynccontextmanager',
    ]) {
      expect(body).not.toContain(keyword);
    }
  });

  /**
   * The body may branch on the flavour only where the two clients genuinely
   * differ in structure rather than in spelling. Today that is the two
   * docstrings and the tag-namespace stream delegate; a new site here means a
   * difference was written inline instead of being derived.
   */
  it('branches on the flavour in the body only where structure differs', () => {
    expect(occurrences(body, 'isAsync')).toBe(4);
    expect(occurrences(body, 'const delegateDef =')).toBe(1);
    expect(occurrences(body, 'const delegate =')).toBe(1);
    // The delegate word is derived, so `yield from` appears only in that
    // derivation and the streaming and non-streaming forms share one
    // argument-forwarding body instead of repeating it.
    expect(occurrences(body, "'yield from '")).toBe(1);
    expect(occurrences(body, 'self._parent._')).toBe(1);
  });

  /**
   * `PYTHON_CLIENT_MEMBERS` is what pushes an operation named after one of the
   * client's own members out of the way. A helper added to the template but not
   * to that set is worse than shadowed: the operation *replaces* the helper, so
   * every other operation calling it breaks. Deriving the expected set from the
   * template is what keeps the two from drifting.
   */
  it('escapes every member the client template defines', () => {
    const defined = new Set([
      ...[...body.matchAll(/self\._([a-z_]+)/g)].map((m) => m[1]),
      ...[...body.matchAll(/^\s+(?:async )?def _([a-z_]+)/gm)]
        .map((m) => m[1])
        // `__init__` is dunder, not a member a spec name can collide with.
        .filter((name) => name !== '_init__'),
    ]);
    const missing = [...defined].filter(
      (name) => !PYTHON_CLIENT_MEMBERS.has(name),
    );
    expect(missing).toEqual([]);
  });
});
