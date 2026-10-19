/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXACT_DEPENDENCY_PINS, LOCKSTEP_GROUPS } from '../versions.js';
import {
  type DependencyLookup,
  EXACT_DEPENDENCY_SOURCES_PATH,
  type ExactDependencySources,
  type ManifestField,
  memoizeLookup,
  pinToExactDependencies,
  verifyExactDependencies,
  writeExactDependencySources,
} from './exact-dependency.js';

/**
 * Published manifest fields, fetched once from the npm registry on 2026-10-15
 * and trimmed to the entries the rule reads.
 */
const REGISTRY: Record<string, Partial<Record<ManifestField, object>>> = {
  // https://registry.npmjs.org/@copilotkit/react-core/1.74.0
  '@copilotkit/react-core@1.74.0': {
    dependencies: {
      '@ag-ui/core': '0.0.59',
      '@ag-ui/client': '0.0.59',
      '@copilotkit/core': '1.74.0',
      rxjs: '7.8.1',
    },
  },
  // https://registry.npmjs.org/@copilotkit/react-core/1.77.0
  '@copilotkit/react-core@1.77.0': {
    dependencies: {
      '@ag-ui/core': '1.0.1',
      '@ag-ui/client': '1.0.1',
      '@copilotkit/core': '1.77.0',
      rxjs: '7.8.1',
    },
  },
  // https://registry.npmjs.org/@copilotkit/react-core/1.79.0
  '@copilotkit/react-core@1.79.0': {
    dependencies: {
      '@ag-ui/core': '1.0.2',
      '@ag-ui/client': '1.0.2',
      '@copilotkit/core': '1.79.0',
      rxjs: '7.8.1',
    },
  },
  // https://registry.npmjs.org/@copilotkit/react-core/1.79.1 (fetched 2026-10-19)
  '@copilotkit/react-core@1.79.1': {
    dependencies: {
      '@ag-ui/core': '1.0.2',
      '@ag-ui/client': '1.0.2',
      '@copilotkit/core': '1.79.1',
      rxjs: '7.8.1',
    },
  },
  // https://registry.npmjs.org/@ag-ui/aws-strands/0.3.0
  '@ag-ui/aws-strands@0.3.0': {
    peerDependencies: {
      '@ag-ui/core': '>=0.0.59',
      '@ag-ui/client': '>=0.0.59',
      '@ag-ui/encoder': '>=0.0.59',
      '@ag-ui/a2ui-toolkit': '>=0.0.3',
      '@strands-agents/sdk': '>=1.1.0',
    },
  },
  // https://registry.npmjs.org/@ag-ui/aws-strands/1.0.0
  '@ag-ui/aws-strands@1.0.0': {
    peerDependencies: {
      '@ag-ui/core': '>=1.0.0',
      '@ag-ui/client': '>=1.0.0',
      '@ag-ui/encoder': '>=0.0.59',
      '@ag-ui/a2ui-toolkit': '>=0.0.3',
      '@strands-agents/sdk': '>=1.1.0',
    },
  },
  // https://registry.npmjs.org/@ag-ui/a2ui-toolkit/0.0.5 (no peerDependencies)
  '@ag-ui/a2ui-toolkit@0.0.5': {},
};

/** Reads the fixtures above; a release they do not hold fails like a 404. */
const lookup =
  (registry = REGISTRY): DependencyLookup =>
  async (name, version, field) => {
    const manifest = registry[`${name}@${version}`];
    if (!manifest) throw new Error(`404 Not Found: ${name}@${version}`);
    return { ...(manifest[field] as Record<string, string> | undefined) };
  };

const RULES = EXACT_DEPENDENCY_PINS;
const GROUPS = LOCKSTEP_GROUPS;

/** The pins this rule covers, as vended. */
const VENDED = {
  '@copilotkit/react-core': '1.79.0',
  '@ag-ui/client': '1.0.2',
  '@ag-ui/core': '1.0.2',
  '@ag-ui/encoder': '1.0.2',
  '@ag-ui/aws-strands': '1.0.0',
  '@ag-ui/a2ui-toolkit': '0.0.5',
  react: '19.2.0',
};

/** The same pins on CopilotKit 1.74.0 and the @ag-ui 0.x line. */
const AG_UI_0X = {
  ...VENDED,
  '@copilotkit/react-core': '1.74.0',
  '@ag-ui/client': '0.0.59',
  '@ag-ui/core': '0.0.59',
  '@ag-ui/encoder': '0.0.59',
  '@ag-ui/aws-strands': '0.3.0',
};

const REASON = RULES[0].reason;

/** What `exact-dependency-sources.json` records for the vended pins. */
const RECORDED: ExactDependencySources = {
  '@copilotkit/react-core': {
    version: '1.79.0',
    dependencies: { '@ag-ui/client': '1.0.2', '@ag-ui/core': '1.0.2' },
  },
};

/** A lookup for a run that must not read the registry. */
const offline: DependencyLookup = async (name, version) => {
  throw new Error(`unexpected read of ${name}@${version}`);
};

describe('pinToExactDependencies', () => {
  it('puts the @ag-ui pins back to what CopilotKit depends on when only @ag-ui moved (drift 1)', async () => {
    const proposed = {
      ...VENDED,
      '@ag-ui/client': '1.0.3',
      '@ag-ui/core': '1.0.3',
      '@ag-ui/encoder': '1.0.3',
    };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      VENDED,
      proposed,
      lookup(),
    );

    expect(proposed).toEqual(VENDED);
    expect(notes).toEqual(
      ['@ag-ui/client', '@ag-ui/core', '@ag-ui/encoder'].map((name) => ({
        name,
        note: `${name} set to 1.0.2 (1.0.3 proposed) to match the exact dependencies of @copilotkit/react-core 1.79.0: ${REASON}`,
      })),
    );
  });

  it('moves the @ag-ui pins with CopilotKit when only CopilotKit moved (drift 2)', async () => {
    // CopilotKit 1.74.0 -> 1.77.0 with @ag-ui unchanged: no stable 0.x after
    // 0.0.59 exists, and the `minor` target never proposes 1.x.
    const proposed = { ...AG_UI_0X, '@copilotkit/react-core': '1.77.0' };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      AG_UI_0X,
      proposed,
      lookup(),
    );

    // aws-strands 0.3.0 declares `>=0.0.59`, so its peer range accepts 1.0.1,
    // though 0.3.0 fails at startup on @ag-ui/core 1.x. The check only sees
    // declared ranges.
    expect(proposed).toEqual({
      ...AG_UI_0X,
      '@copilotkit/react-core': '1.77.0',
      '@ag-ui/client': '1.0.1',
      '@ag-ui/core': '1.0.1',
      '@ag-ui/encoder': '1.0.1',
    });
    expect(notes.map(({ note }) => note)).toEqual(
      ['@ag-ui/client', '@ag-ui/core', '@ag-ui/encoder'].map(
        (name) =>
          `${name} set to 1.0.1 (0.0.59 proposed) to match the exact dependencies of @copilotkit/react-core 1.77.0: ${REASON}`,
      ),
    );
  });

  it('moves the @ag-ui pins when CopilotKit and aws-strands move together', async () => {
    const proposed = {
      ...AG_UI_0X,
      '@copilotkit/react-core': '1.79.0',
      '@ag-ui/aws-strands': '1.0.0',
    };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      AG_UI_0X,
      proposed,
      lookup(),
    );

    expect(proposed).toEqual(VENDED);
    expect(notes).toHaveLength(3);
  });

  it('changes nothing and reports nothing when the pins already match', async () => {
    const proposed = { ...VENDED };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      VENDED,
      proposed,
      lookup(),
    );

    expect(notes).toEqual([]);
    expect(proposed).toEqual(VENDED);
  });

  it('holds everything at current when aws-strands would not accept the @ag-ui CopilotKit needs', async () => {
    // aws-strands 1.0.0 needs @ag-ui/core >=1.0.0, CopilotKit 1.74.0 needs 0.0.59.
    const proposed = { ...AG_UI_0X, '@ag-ui/aws-strands': '1.0.0' };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      AG_UI_0X,
      proposed,
      lookup(),
    );

    expect(proposed).toEqual(AG_UI_0X);
    expect(notes).toEqual([
      {
        name: '@copilotkit/react-core',
        note:
          '@copilotkit/react-core held at 1.74.0, with @ag-ui/client, @ag-ui/core, @ag-ui/encoder, @ag-ui/aws-strands, @ag-ui/a2ui-toolkit at their current versions (not taken: @ag-ui/aws-strands 1.0.0): ' +
          '@ag-ui/aws-strands 1.0.0 requires @ag-ui/client >=1.0.0, but @copilotkit/react-core 1.74.0 needs 0.0.59; ' +
          '@ag-ui/aws-strands 1.0.0 requires @ag-ui/core >=1.0.0, but @copilotkit/react-core 1.74.0 needs 0.0.59',
      },
    ]);
  });

  it('holds everything at current when a CopilotKit release needs an @ag-ui major aws-strands rejects', async () => {
    // Hypothetical releases with the real manifests' shape: a CopilotKit that
    // moves to @ag-ui 2.0.0, and an aws-strands that caps its peers below 2.
    const registry = {
      ...REGISTRY,
      '@copilotkit/react-core@1.90.0': {
        dependencies: { '@ag-ui/core': '2.0.0', '@ag-ui/client': '2.0.0' },
      },
      '@ag-ui/aws-strands@1.1.0': {
        peerDependencies: {
          '@ag-ui/core': '>=1.0.0 <2',
          '@ag-ui/client': '>=1.0.0 <2',
          '@ag-ui/encoder': '>=0.0.59',
        },
      },
    };
    const current = { ...VENDED, '@ag-ui/aws-strands': '1.1.0' };
    const proposed = {
      ...current,
      '@copilotkit/react-core': '1.90.0',
      react: '19.3.0',
    };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      current,
      proposed,
      lookup(registry),
    );

    // Pins outside the rule keep the run's proposal.
    expect(proposed).toEqual({ ...current, react: '19.3.0' });
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toMatch(
      /^@copilotkit\/react-core held at 1\.79\.0, .*\(not taken: @copilotkit\/react-core 1\.90\.0\): @ag-ui\/aws-strands 1\.1\.0 requires @ag-ui\/client >=1\.0\.0 <2, but @copilotkit\/react-core 1\.90\.0 needs 2\.0\.0;/,
    );
  });

  it('holds everything at current when CopilotKit dependencies cannot be read', async () => {
    const proposed = {
      ...VENDED,
      '@copilotkit/react-core': '1.80.0',
      '@ag-ui/client': '1.0.3',
      '@ag-ui/core': '1.0.3',
      '@ag-ui/encoder': '1.0.3',
    };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      VENDED,
      proposed,
      lookup(),
    );

    expect(proposed).toEqual(VENDED);
    expect(notes).toEqual([
      {
        name: '@copilotkit/react-core',
        note: '@copilotkit/react-core held at 1.79.0, with @ag-ui/client, @ag-ui/core, @ag-ui/encoder, @ag-ui/aws-strands, @ag-ui/a2ui-toolkit at their current versions (not taken: @copilotkit/react-core 1.80.0, @ag-ui/client 1.0.3, @ag-ui/core 1.0.3, @ag-ui/encoder 1.0.3): could not read the dependencies of @copilotkit/react-core 1.80.0 (404 Not Found: @copilotkit/react-core@1.80.0)',
      },
    ]);
  });

  it('holds everything at current when a peer manifest cannot be read', async () => {
    const proposed = {
      ...VENDED,
      '@ag-ui/aws-strands': '1.0.1',
    };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      VENDED,
      proposed,
      lookup(),
    );

    expect(proposed).toEqual(VENDED);
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toContain(
      'could not read the peerDependencies of @ag-ui/aws-strands 1.0.1',
    );
  });

  it('keeps @ag-ui/encoder equal to @ag-ui/core', async () => {
    // The lockstep can only hold a group back, so an encoder the run did not
    // move would otherwise stay behind the core CopilotKit needs.
    const proposed = { ...AG_UI_0X, '@copilotkit/react-core': '1.79.0' };
    proposed['@ag-ui/aws-strands'] = '1.0.0';
    proposed['@ag-ui/encoder'] = '0.0.59';

    await pinToExactDependencies(RULES, GROUPS, AG_UI_0X, proposed, lookup());

    expect(proposed['@ag-ui/encoder']).toBe('1.0.2');
    expect(proposed['@ag-ui/encoder']).toBe(proposed['@ag-ui/core']);
  });

  it('takes the bare version when the source declares a range', async () => {
    const registry = {
      ...REGISTRY,
      '@copilotkit/react-core@1.79.0': {
        dependencies: { '@ag-ui/core': '^1.0.2', '@ag-ui/client': '~1.0.2' },
      },
    };
    const proposed = { ...VENDED, '@ag-ui/core': '1.0.3' };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      VENDED,
      proposed,
      lookup(registry),
    );

    expect(proposed).toEqual(VENDED);
    expect(notes.map(({ name }) => name)).toEqual(['@ag-ui/core']);
  });

  it('holds everything at current when the source does not depend on a follower', async () => {
    const registry = {
      ...REGISTRY,
      '@copilotkit/react-core@1.79.0': {
        dependencies: { '@ag-ui/client': '1.0.2' },
      },
    };
    const proposed = { ...VENDED, '@ag-ui/aws-strands': '1.0.1' };

    const notes = await pinToExactDependencies(
      RULES,
      GROUPS,
      VENDED,
      proposed,
      lookup(registry),
    );

    expect(proposed).toEqual(VENDED);
    expect(notes[0].note).toContain(
      '@copilotkit/react-core 1.79.0 does not depend on @ag-ui/core',
    );
  });
});

describe('verifyExactDependencies', () => {
  const MISMATCH = {
    ...VENDED,
    '@ag-ui/client': '1.0.1',
    '@ag-ui/core': '1.0.1',
    '@ag-ui/encoder': '1.0.1',
  };

  it('reuses the recorded dependencies when CopilotKit did not move', async () => {
    await expect(
      verifyExactDependencies(RULES, VENDED, RECORDED, offline),
    ).resolves.toEqual(RECORDED);
  });

  it('records the new release when CopilotKit moved and its @ag-ui dependencies did not', async () => {
    const versions = { ...VENDED, '@copilotkit/react-core': '1.79.1' };

    await expect(
      verifyExactDependencies(RULES, versions, RECORDED, lookup()),
    ).resolves.toEqual({
      '@copilotkit/react-core': {
        version: '1.79.1',
        dependencies: { '@ag-ui/client': '1.0.2', '@ag-ui/core': '1.0.2' },
      },
    });
  });

  it('records the new release when @ag-ui moved with CopilotKit', async () => {
    const recorded: ExactDependencySources = {
      '@copilotkit/react-core': {
        version: '1.77.0',
        dependencies: { '@ag-ui/client': '1.0.1', '@ag-ui/core': '1.0.1' },
      },
    };

    await expect(
      verifyExactDependencies(RULES, VENDED, recorded, lookup()),
    ).resolves.toEqual(RECORDED);
  });

  it('throws when an @ag-ui pin differs from what CopilotKit depends on', async () => {
    const result = verifyExactDependencies(RULES, MISMATCH, RECORDED, offline);

    await expect(result).rejects.toThrow(
      '@ag-ui/client 1.0.1, @ag-ui/core 1.0.1 but @copilotkit/react-core 1.79.0 depends on @ag-ui/client 1.0.2, @ag-ui/core 1.0.2',
    );
    await expect(result).rejects.toThrow(REASON);
  });

  it('throws when the dependencies of a CopilotKit it has not recorded cannot be read', async () => {
    const versions = { ...VENDED, '@copilotkit/react-core': '1.80.0' };

    await expect(
      verifyExactDependencies(RULES, versions, RECORDED, lookup()),
    ).rejects.toThrow(
      /could not read the dependencies of @copilotkit\/react-core 1\.80\.0/,
    );
  });

  it('throws when CopilotKit does not depend on a follower', async () => {
    const registry = {
      ...REGISTRY,
      '@copilotkit/react-core@1.79.1': {
        dependencies: { '@ag-ui/client': '1.0.2' },
      },
    };
    const versions = { ...VENDED, '@copilotkit/react-core': '1.79.1' };

    await expect(
      verifyExactDependencies(RULES, versions, RECORDED, lookup(registry)),
    ).rejects.toThrow(
      '@copilotkit/react-core 1.79.1 does not depend on @ag-ui/core',
    );
  });

  it('takes the bare version when CopilotKit declares a range', async () => {
    const registry = {
      ...REGISTRY,
      '@copilotkit/react-core@1.79.1': {
        dependencies: { '@ag-ui/core': '^1.0.2', '@ag-ui/client': '~1.0.2' },
      },
    };
    const versions = { ...VENDED, '@copilotkit/react-core': '1.79.1' };

    const sources = await verifyExactDependencies(
      RULES,
      versions,
      RECORDED,
      lookup(registry),
    );

    expect(sources['@copilotkit/react-core'].dependencies).toEqual({
      '@ag-ui/client': '1.0.2',
      '@ag-ui/core': '1.0.2',
    });
  });

  it('passes the pins a held rule leaves at current', async () => {
    const proposed = {
      ...VENDED,
      '@copilotkit/react-core': '1.80.0',
      '@ag-ui/client': '1.0.3',
      '@ag-ui/core': '1.0.3',
      '@ag-ui/encoder': '1.0.3',
    };
    await pinToExactDependencies(RULES, GROUPS, VENDED, proposed, lookup());

    await expect(
      verifyExactDependencies(RULES, proposed, RECORDED, offline),
    ).resolves.toEqual(RECORDED);
  });
});

describe('writeExactDependencySources', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    writeJson(tree, EXACT_DEPENDENCY_SOURCES_PATH, RECORDED);
  });

  const read = () => tree.read(EXACT_DEPENDENCY_SOURCES_PATH, 'utf-8');

  it('writes the record when CopilotKit moved', async () => {
    const versions = { ...VENDED, '@copilotkit/react-core': '1.79.1' };

    const written = await writeExactDependencySources(
      tree,
      RULES,
      versions,
      lookup(),
    );

    expect(written).toEqual([EXACT_DEPENDENCY_SOURCES_PATH]);
    expect(JSON.parse(read() ?? '')).toEqual({
      '@copilotkit/react-core': {
        version: '1.79.1',
        dependencies: { '@ag-ui/client': '1.0.2', '@ag-ui/core': '1.0.2' },
      },
    });
  });

  it('leaves the file as it is when nothing moved', async () => {
    const before = read();

    const written = await writeExactDependencySources(
      tree,
      RULES,
      VENDED,
      offline,
    );

    expect(written).toEqual([]);
    expect(read()).toBe(before);
  });

  it('writes nothing when the pins do not match', async () => {
    const before = read();
    const versions = {
      ...VENDED,
      '@ag-ui/client': '1.0.1',
      '@ag-ui/core': '1.0.1',
      '@ag-ui/encoder': '1.0.1',
    };

    await expect(
      writeExactDependencySources(tree, RULES, versions, offline),
    ).rejects.toThrow('but @copilotkit/react-core 1.79.0 depends on');
    expect(read()).toBe(before);
  });
});

describe('memoizeLookup', () => {
  it("reads each release's field once", async () => {
    const inner = vi.fn(lookup());
    const memoized = memoizeLookup(inner);

    const first = await memoized(
      '@copilotkit/react-core',
      '1.79.0',
      'dependencies',
    );
    const second = await memoized(
      '@copilotkit/react-core',
      '1.79.0',
      'dependencies',
    );
    await memoized('@copilotkit/react-core', '1.79.0', 'peerDependencies');

    expect(inner).toHaveBeenCalledTimes(2);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('fails a repeated read the way the first failed', async () => {
    const inner = vi.fn(lookup());
    const memoized = memoizeLookup(inner);

    await expect(
      memoized('@copilotkit/react-core', '1.80.0', 'dependencies'),
    ).rejects.toThrow('404 Not Found: @copilotkit/react-core@1.80.0');
    await expect(
      memoized('@copilotkit/react-core', '1.80.0', 'dependencies'),
    ).rejects.toThrow('404 Not Found: @copilotkit/react-core@1.80.0');
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
