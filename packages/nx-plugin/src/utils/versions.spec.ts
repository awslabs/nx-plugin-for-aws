/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import PluginPackageJson from '../../package.json' with { type: 'json' };
import { NX_PACKAGES, NX_VERSION, TS_VERSIONS, withVersions } from './versions';

describe('versions utils', () => {
  describe('withVersions', () => {
    it('should return empty object for empty dependencies array', () => {
      expect(withVersions([])).toEqual({});
    });
    it('should map single dependency to its version', () => {
      const deps: (keyof typeof TS_VERSIONS)[] = ['zod'];
      expect(withVersions(deps)).toEqual({
        zod: TS_VERSIONS['zod'],
      });
    });
    it('should map multiple dependencies to their versions', () => {
      const deps: (keyof typeof TS_VERSIONS)[] = [
        'aws-cdk-lib',
        'constructs',
        'zod',
      ];
      const expected = {
        'aws-cdk-lib': TS_VERSIONS['aws-cdk-lib'],
        constructs: TS_VERSIONS['constructs'],
        zod: TS_VERSIONS['zod'],
      };
      expect(withVersions(deps)).toEqual(expected);
    });
    it('should handle aws dependencies correctly', () => {
      const deps: (keyof typeof TS_VERSIONS)[] = [
        '@trpc/client',
        '@tanstack/react-query',
        '@tanstack/react-query-devtools',
      ];
      const expected = {
        '@trpc/client': TS_VERSIONS['@trpc/client'],
        '@tanstack/react-query': TS_VERSIONS['@tanstack/react-query'],
        '@tanstack/react-query-devtools':
          TS_VERSIONS['@tanstack/react-query-devtools'],
      };
      expect(withVersions(deps)).toEqual(expected);
    });
    it('should handle cloudscape dependencies correctly', () => {
      const deps: (keyof typeof TS_VERSIONS)[] = [
        '@cloudscape-design/components',
        '@cloudscape-design/board-components',
      ];
      const expected = {
        '@cloudscape-design/components':
          TS_VERSIONS['@cloudscape-design/components'],
        '@cloudscape-design/board-components':
          TS_VERSIONS['@cloudscape-design/board-components'],
      };
      expect(withVersions(deps)).toEqual(expected);
    });
    it('should preserve version strings exactly as defined', () => {
      const deps: (keyof typeof TS_VERSIONS)[] = ['aws-cdk-lib'];
      const result = withVersions(deps);
      expect(result['aws-cdk-lib']).toBe(TS_VERSIONS['aws-cdk-lib']);
      expect(result['aws-cdk-lib']).toMatch(/^\d+\.\d+\.\d+$/); // Should be exact version
    });
  });

  describe('nx versions', () => {
    it('should keep every nx package on the same version', () => {
      // A workspace nx even a patch apart from the plugin's `@nx/*` packages
      // hoists a second nested nx, and the two deadlock `nx sync`.
      for (const nxPackage of NX_PACKAGES) {
        expect(TS_VERSIONS[nxPackage]).toBe(NX_VERSION);
      }
    });

    it('should match the version of the nx packages the plugin depends on', () => {
      // The plugin's own `@nx/*` dependencies are what its generators run
      // against, so a workspace pinned from TS_VERSIONS must agree with them.
      for (const [name, version] of Object.entries<string>({
        ...PluginPackageJson.dependencies,
      })) {
        if (NX_PACKAGES.includes(name as (typeof NX_PACKAGES)[number])) {
          expect(version).toBe(NX_VERSION);
        }
      }
    });
  });
});
