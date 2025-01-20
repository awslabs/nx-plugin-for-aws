/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { withVersions, VERSIONS } from './versions';
describe('versions utils', () => {
  describe('withVersions', () => {
    it('should return empty object for empty dependencies array', () => {
      expect(withVersions([])).toEqual({});
    });
    it('should map single dependency to its version', () => {
      const deps: (keyof typeof VERSIONS)[] = ['zod'];
      expect(withVersions(deps)).toEqual({
        zod: VERSIONS['zod'],
      });
    });
    it('should map multiple dependencies to their versions', () => {
      const deps: (keyof typeof VERSIONS)[] = [
        'aws-cdk-lib',
        'constructs',
        'zod',
      ];
      const expected = {
        'aws-cdk-lib': VERSIONS['aws-cdk-lib'],
        constructs: VERSIONS['constructs'],
        zod: VERSIONS['zod'],
      };
      expect(withVersions(deps)).toEqual(expected);
    });
    it('should handle aws dependencies correctly', () => {
      const deps: (keyof typeof VERSIONS)[] = [
        '@aws-sdk/client-wafv2',
        '@aws/pdk',
      ];
      const expected = {
        '@aws-sdk/client-wafv2': VERSIONS['@aws-sdk/client-wafv2'],
        '@aws/pdk': VERSIONS['@aws/pdk'],
      };
      expect(withVersions(deps)).toEqual(expected);
    });
    it('should handle cloudscape dependencies correctly', () => {
      const deps: (keyof typeof VERSIONS)[] = [
        '@cloudscape-design/components',
        '@cloudscape-design/board-components',
      ];
      const expected = {
        '@cloudscape-design/components':
          VERSIONS['@cloudscape-design/components'],
        '@cloudscape-design/board-components':
          VERSIONS['@cloudscape-design/board-components'],
      };
      expect(withVersions(deps)).toEqual(expected);
    });
    it('should preserve version strings exactly as defined', () => {
      const deps: (keyof typeof VERSIONS)[] = ['aws-cdk-lib'];
      const result = withVersions(deps);
      expect(result['aws-cdk-lib']).toBe(VERSIONS['aws-cdk-lib']);
      expect(result['aws-cdk-lib']).toMatch(/^\^/); // Should preserve caret
    });
  });
});
