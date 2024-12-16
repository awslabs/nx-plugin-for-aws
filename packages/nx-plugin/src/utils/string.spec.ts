/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { uniq } from './string';

describe('string utils', () => {
  describe('uniq', () => {
    it('should remove duplicates from array of numbers', () => {
      expect(uniq([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4]);
    });

    it('should remove duplicates from array of strings', () => {
      expect(uniq(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
    });

    it('should handle empty array', () => {
      expect(uniq([])).toEqual([]);
    });

    it('should maintain order of first appearance', () => {
      expect(uniq(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
    });

    it('should handle array with all duplicate elements', () => {
      expect(uniq(['a', 'a', 'a'])).toEqual(['a']);
    });

    it('should handle array with mixed types', () => {
      const input = [1, '1', true, 1, '1', true];
      expect(uniq(input)).toEqual([1, '1', true]);
    });
  });
});
