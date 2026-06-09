/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { deepEquals, sortObjectKeys } from './object';

describe('sortObjectKeys', () => {
  it('sorts keys alphabetically', () => {
    expect(Object.keys(sortObjectKeys({ b: 1, a: 2, c: 3 }))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('deepEquals', () => {
  it('treats objects with different key order as equal', () => {
    expect(deepEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('compares nested objects ignoring key order', () => {
    expect(
      deepEquals(
        { generator: 'ts#foo', nested: { x: 1, y: 2 } },
        { nested: { y: 2, x: 1 }, generator: 'ts#foo' },
      ),
    ).toBe(true);
  });

  it('returns false when values differ', () => {
    expect(deepEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('returns false when keys differ', () => {
    expect(deepEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('compares arrays by order', () => {
    expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEquals([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it('handles primitives and null', () => {
    expect(deepEquals(1, 1)).toBe(true);
    expect(deepEquals('a', 'a')).toBe(true);
    expect(deepEquals(null, null)).toBe(true);
    expect(deepEquals(null, {})).toBe(false);
    expect(deepEquals(undefined, {})).toBe(false);
  });
});
