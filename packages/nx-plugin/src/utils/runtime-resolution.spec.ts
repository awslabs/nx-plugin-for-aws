/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  type RuntimeCeiling,
  resolveRuntimeVersions,
} from './runtime-resolution.js';

/**
 * The resolution both runtime pins share, driven with fixture pins rather than
 * the vended ones.
 *
 * The Lambda and AgentCore resolvers read their live pins, so a case about where
 * a ceiling sits relative to the pin cannot be written against them without
 * breaking the next time a pin moves. Here the pins are an argument.
 */

/** Pins standing in for a vended runtime map. */
const CURRENT = { node: '24' } as const;

const parse = (
  identifier: string,
): { language: 'node'; version: string } | undefined => {
  const node = /^nodejs(\d+)\.x$/.exec(identifier);
  return node ? { language: 'node', version: node[1] } : undefined;
};

const ceiling = (value: string): Partial<Record<'node', RuntimeCeiling>> => ({
  node: {
    ceiling: value,
    reason: 'the vended image',
    liftWhen: 'it is tested',
  },
});

const resolve = (identifiers: readonly string[], ceilings = {}) =>
  resolveRuntimeVersions({
    current: CURRENT,
    identifiers,
    parse,
    ceilings,
  });

describe('runtime resolution', () => {
  it('should take the newest runtime listed when nothing is held', () => {
    expect(resolve(['nodejs24.x', 'nodejs26.x']).versions).toEqual({
      node: '26',
    });
  });

  it('should move up to the ceiling but no further', () => {
    const { versions } = resolveRuntimeVersions({
      current: CURRENT,
      identifiers: ['nodejs26.x'],
      parse,
      ceilings: ceiling('25'),
    });

    expect(versions).toEqual({ node: '25' });
  });

  // The weekly PR body carries both the change line and the hold note, so a note
  // naming the version the run started from would contradict a change line that
  // moved it.
  it('should name the version it kept when the ceiling is above the pin', () => {
    const { versions, unresolved } = resolveRuntimeVersions({
      current: CURRENT,
      identifiers: ['nodejs26.x'],
      parse,
      ceilings: ceiling('25'),
    });

    expect(versions.node).toBe('25');
    expect(unresolved).toEqual([
      {
        language: 'node',
        kept: '25',
        reason: 'held-below-ceiling',
        detail: 'the vended image',
        liftWhen: 'it is tested',
      },
    ]);
  });

  it('should keep the pin when the ceiling is the pin', () => {
    const { versions, unresolved } = resolveRuntimeVersions({
      current: CURRENT,
      identifiers: ['nodejs26.x'],
      parse,
      ceilings: ceiling('24'),
    });

    expect(versions.node).toBe('24');
    expect(unresolved[0].kept).toBe('24');
  });

  it('should release the runtime once the ceiling reaches it', () => {
    const { versions, unresolved } = resolveRuntimeVersions({
      current: CURRENT,
      identifiers: ['nodejs26.x'],
      parse,
      ceilings: ceiling('26'),
    });

    expect(versions.node).toBe('26');
    expect(unresolved).toEqual([]);
  });

  it('should report a language the list says nothing about', () => {
    expect(resolve(['python3.14']).unresolved).toEqual([
      { language: 'node', kept: '24', reason: 'no-runtimes-listed' },
    ]);
  });

  it('should never move a runtime backwards', () => {
    expect(resolve(['nodejs20.x']).versions).toEqual({ node: '24' });
  });
});
