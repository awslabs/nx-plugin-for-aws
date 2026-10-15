/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { coerce, gte, major } from 'semver';
import { describe, expect, it } from 'vitest';
import PluginPackageJson from '../../package.json' with { type: 'json' };
import {
  type DeclaredTs,
  declareDependencies,
} from './declared-dependencies.js';
import {
  EXACT_DEPENDENCY_PINS,
  type ITsDepVersion,
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

describe('AG-UI compatibility', () => {
  // @copilotkit/react-core 1.76.0 is the first release that depends on @ag-ui 1.x,
  // at an exact version. @ag-ui/aws-strands 1.0.0 is the first release that
  // imports its validators from @ag-ui/core/schemas, the only entry that exports
  // them in @ag-ui/core 1.x.
  const versionOf = (name: ITsDepVersion): string =>
    coerce(TS_VERSIONS[name])?.version ?? TS_VERSIONS[name];

  it('vends the AG-UI 1.x line to the website and the TypeScript AG-UI agent', () => {
    expect(gte(versionOf('@copilotkit/react-core'), '1.76.0')).toBe(true);
    for (const name of [
      '@ag-ui/client',
      '@ag-ui/core',
      '@ag-ui/encoder',
      '@ag-ui/aws-strands',
    ] as const) {
      expect(major(versionOf(name)), name).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * The `@ag-ui` entries of the vended CopilotKit release's `dependencies`, from
   * https://registry.npmjs.org/@copilotkit/react-core/1.79.0 (fetched 2026-10-15).
   *
   * Update this fixture whenever the `@copilotkit/react-core` pin moves: copy the
   * new release's `@ag-ui/client` and `@ag-ui/core` entries from
   * `curl -s https://registry.npmjs.org/@copilotkit/react-core/<version> | jq .dependencies`.
   */
  const COPILOTKIT_AG_UI_DEPENDENCIES = {
    version: '1.79.0',
    dependencies: { '@ag-ui/client': '1.0.2', '@ag-ui/core': '1.0.2' },
  } as const;

  it('pins @ag-ui at exactly the versions the vended CopilotKit depends on', () => {
    // A different pin installs a second @ag-ui/client and fails every
    // generated website with TS2322.
    expect(
      TS_VERSIONS['@copilotkit/react-core'],
      'the CopilotKit pin moved: update COPILOTKIT_AG_UI_DEPENDENCIES',
    ).toBe(COPILOTKIT_AG_UI_DEPENDENCIES.version);
    for (const [name, version] of Object.entries(
      COPILOTKIT_AG_UI_DEPENDENCIES.dependencies,
    )) {
      expect(TS_VERSIONS[name as ITsDepVersion], name).toBe(version);
    }
    expect(TS_VERSIONS['@ag-ui/encoder']).toBe(TS_VERSIONS['@ag-ui/core']);
  });

  it('has the version update keep @ag-ui on the exact versions CopilotKit depends on', () => {
    expect(EXACT_DEPENDENCY_PINS).toContainEqual(
      expect.objectContaining({
        source: '@copilotkit/react-core',
        followers: Object.keys(COPILOTKIT_AG_UI_DEPENDENCIES.dependencies),
      }),
    );
    for (const { source, followers, peers } of EXACT_DEPENDENCY_PINS) {
      for (const name of [source, ...followers, ...peers]) {
        expect(TS_VERSIONS[name], `${name} is not a vended pin`).toBeDefined();
      }
    }
  });
});
