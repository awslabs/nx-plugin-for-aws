/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import PluginPackageJson from '../../package.json' with { type: 'json' };
import {
  type DeclaredTs,
  declareDependencies,
} from './declared-dependencies.js';
import {
  LOCKSTEP_GROUPS,
  NX_PACKAGES,
  NX_VERSION,
  PY_VERSIONS,
  TS_VERSIONS,
  withVersions,
} from './versions.js';

const declaration = declareDependencies()({
  ts: [
    { name: 'zod' },
    { name: 'aws-cdk-lib' },
    { name: 'constructs' },
    { name: '@trpc/client' },
    { name: '@tanstack/react-query' },
    { name: '@tanstack/react-query-devtools' },
    { name: '@cloudscape-design/components' },
    { name: '@cloudscape-design/board-components' },
  ],
});
type SpecTsDep = DeclaredTs<typeof declaration>;

describe('versions utils', () => {
  describe('withVersions', () => {
    it('should return empty object for empty dependencies array', () => {
      expect(withVersions(declaration, [])).toEqual({});
    });
    it('should map single dependency to its version', () => {
      const deps: SpecTsDep[] = ['zod'];
      expect(withVersions(declaration, deps)).toEqual({
        zod: TS_VERSIONS['zod'],
      });
    });
    it('should map multiple dependencies to their versions', () => {
      const deps: SpecTsDep[] = ['aws-cdk-lib', 'constructs', 'zod'];
      const expected = {
        'aws-cdk-lib': TS_VERSIONS['aws-cdk-lib'],
        constructs: TS_VERSIONS['constructs'],
        zod: TS_VERSIONS['zod'],
      };
      expect(withVersions(declaration, deps)).toEqual(expected);
    });
    it('should handle aws dependencies correctly', () => {
      const deps: SpecTsDep[] = [
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
      expect(withVersions(declaration, deps)).toEqual(expected);
    });
    it('should handle cloudscape dependencies correctly', () => {
      const deps: SpecTsDep[] = [
        '@cloudscape-design/components',
        '@cloudscape-design/board-components',
      ];
      const expected = {
        '@cloudscape-design/components':
          TS_VERSIONS['@cloudscape-design/components'],
        '@cloudscape-design/board-components':
          TS_VERSIONS['@cloudscape-design/board-components'],
      };
      expect(withVersions(declaration, deps)).toEqual(expected);
    });
    it('should preserve version strings exactly as defined', () => {
      const deps: SpecTsDep[] = ['aws-cdk-lib'];
      const result = withVersions(declaration, deps);
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

describe('LOCKSTEP_GROUPS', () => {
  // A group's members are only correct at the same version, and the version
  // update holds them together. If one is bumped by hand the group has to move
  // with it, so assert they agree rather than waiting for a generated project to
  // fail to build.
  const manifest = PluginPackageJson as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const bare = (version: string) => version.replace(/^[=~^]+/, '');
  const versionOf = (name: string): string | undefined => {
    const pinned =
      (TS_VERSIONS as Record<string, string>)[name] ??
      (PY_VERSIONS as Record<string, string>)[name] ??
      manifest.dependencies?.[name] ??
      manifest.devDependencies?.[name];
    return pinned === undefined ? undefined : bare(pinned);
  };

  it.each(LOCKSTEP_GROUPS.map((group) => [group.join(', '), group] as const))(
    'pins every member of [%s] at the same version',
    (_label, group) => {
      const versions = group.map((name) => {
        const version = versionOf(name);
        expect(version, `${name} is not pinned anywhere`).toBeDefined();
        return [name, version] as const;
      });
      const [, expected] = versions[0];
      for (const [name, version] of versions) {
        expect(version, `${name} disagrees with ${group[0]}`).toBe(expected);
      }
    },
  );
});
