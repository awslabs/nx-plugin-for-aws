/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { isRef, splitRef, resolveRef, resolveIfRef } from './refs';
import type { OpenAPIV3 } from 'openapi-types';
import type { Spec } from './types';

const testSpec: Spec = {
  openapi: '3.0.3',
  info: {
    title: 'Test',
    version: '1.0.0',
  },
  components: {
    schemas: {
      Test: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
      Nested: {
        type: 'object',
        properties: {
          test: { $ref: '#/components/schemas/Test' },
        },
      },
    },
  },
};

describe('refs', () => {
  describe('isRef', () => {
    it('should return true for valid reference objects', () => {
      const ref: OpenAPIV3.ReferenceObject = {
        $ref: '#/components/schemas/Test',
      };
      expect(isRef(ref)).toBe(true);
    });

    it('should return false for non-reference objects', () => {
      expect(isRef(null)).toBe(false);
      expect(isRef(undefined)).toBe(false);
      expect(isRef({})).toBe(false);
      expect(isRef({ something: 'else' })).toBe(false);
      expect(isRef(42)).toBe(false);
      expect(isRef('string')).toBe(false);
    });
  });

  describe('splitRef', () => {
    it('should split a basic reference correctly', () => {
      const result = splitRef('#/components/schemas/Test');
      expect(result).toEqual(['components', 'schemas', 'Test']);
    });

    it('should handle escaped characters', () => {
      const result = splitRef('#/components/schemas/Test~1Path~0Tilde');
      expect(result).toEqual(['components', 'schemas', 'Test/Path~Tilde']);
    });
  });

  describe('resolveRef', () => {
    it('should resolve a direct reference', () => {
      const result = resolveRef(testSpec, '#/components/schemas/Test');
      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      });
    });

    it('should throw error for unresolvable reference', () => {
      expect(() =>
        resolveRef(testSpec, '#/components/schemas/NonExistent'),
      ).toThrow(
        'Unable to resolve ref #/components/schemas/NonExistent in spec',
      );
    });
  });

  describe('resolveIfRef', () => {
    it('should resolve a reference object', () => {
      const ref: OpenAPIV3.ReferenceObject = {
        $ref: '#/components/schemas/Test',
      };
      const result = resolveIfRef(testSpec, ref);
      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      });
    });

    it('should return non-reference object as-is', () => {
      const nonRef = { type: 'string' };
      const result = resolveIfRef(testSpec, nonRef);
      expect(result).toBe(nonRef);
    });
  });
});
