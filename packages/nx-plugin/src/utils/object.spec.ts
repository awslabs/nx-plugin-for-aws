/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { sortObjectKeys } from './object';

describe('sortObjectKeys', () => {
  it('sorts keys alphabetically', () => {
    expect(Object.keys(sortObjectKeys({ b: 1, a: 2, c: 3 }))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
