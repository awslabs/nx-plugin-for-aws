/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../config/utils';
import { declaredNames } from '../declared-dependencies';
import { buildGeneratorInfoList } from '../generators';
import { createTreeUsingTsSolutionSetup } from '../test';
import { PY_VERSIONS, TS_VERSIONS } from '../versions';
import {
  generatorsRun,
  ownedDependencies,
  PLUGIN_ROOT,
} from './owned-dependencies';

const addProject = (
  tree: Tree,
  name: string,
  metadata: ProjectConfiguration['metadata'],
) =>
  addProjectConfiguration(tree, name, {
    root: `packages/${name}`,
    metadata,
  });

describe('generatorsRun', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should read the generator that created each project', () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);
    addProject(tree, 'lib', { generator: 'ts#project' } as never);

    expect([...generatorsRun(tree)].sort()).toEqual([
      'ts#project',
      'ts#trpc-api',
    ]);
  });

  it('should read the generators that added components', () => {
    addProject(tree, 'lib', {
      generator: 'ts#project',
      components: [{ generator: 'ts#mcp-server' }, { generator: 'ts#agent' }],
    } as never);

    expect([...generatorsRun(tree)].sort()).toEqual([
      'ts#agent',
      'ts#mcp-server',
      'ts#project',
    ]);
  });

  it('should treat the config file as init having run', () => {
    // init creates no project, so nothing else records it.
    tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'export default {};');

    expect([...generatorsRun(tree)]).toEqual(['init']);
  });

  it('should find nothing in a workspace no generator has touched', () => {
    addProject(tree, 'hand-written', undefined);

    expect([...generatorsRun(tree)]).toEqual([]);
  });
});

describe('ownedDependencies', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should own nothing when no generator has run', async () => {
    const owned = await ownedDependencies(tree);

    expect(owned.ts.size).toBe(0);
    expect(owned.py.size).toBe(0);
  });

  it('should own the dependencies the generators that ran declare', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('zod')).toBe(true);
    expect(owned.ts.has('@trpc/server')).toBe(true);
  });

  it('should not own the dependencies of a generator that did not run', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);

    const owned = await ownedDependencies(tree);

    // Declared only by the Python generators.
    expect(owned.py.has('ruff')).toBe(false);
  });

  it('should own python dependencies declared by python generators', async () => {
    addProject(tree, 'py', { generator: 'py#project' } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.py.has('ruff')).toBe(true);
  });

  // The `when` conditions on a declaration read the values the generator
  // recorded, so a project owns only the branch it was generated with.
  it('should own only the branch the recorded metadata selects', async () => {
    addProject(tree, 'agent-a2a', {
      generator: 'ts#project',
      components: [
        { generator: 'ts#agent', name: 'agent', protocol: 'a2a', auth: 'iam' },
      ],
    } as never);

    const owned = await ownedDependencies(tree);

    // The a2a branch.
    expect(owned.ts.has('@a2a-js/sdk')).toBe(true);
    // The http and ag-ui branches this project did not take.
    expect(owned.ts.has('@trpc/server')).toBe(false);
    expect(owned.ts.has('@ag-ui/client')).toBe(false);
  });

  it('should own each branch when a workspace has one project per branch', async () => {
    addProject(tree, 'agents', {
      generator: 'ts#project',
      components: [
        { generator: 'ts#agent', name: 'a', protocol: 'a2a', auth: 'iam' },
        { generator: 'ts#agent', name: 'b', protocol: 'http', auth: 'iam' },
      ],
    } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('@a2a-js/sdk')).toBe(true);
    expect(owned.ts.has('@trpc/server')).toBe(true);
    // Still nothing from the branch neither project took.
    expect(owned.ts.has('@ag-ui/client')).toBe(false);
  });

  // The AG-UI helper picks its theme module from the website's `ux`, and the
  // connection records the resolved value — so a website on one theme does not
  // own another's styling packages.
  it('should own only the theme the connection resolved', async () => {
    addProject(tree, 'website', {
      generator: 'ts#project',
      components: [
        {
          generator: 'ts#agent#react-connection',
          name: 'agent',
          protocol: 'ag-ui',
          auth: 'none',
          theme: 'shadcn',
        },
      ],
    } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('lucide-react')).toBe(true);
    // The cloudscape theme this website did not resolve to.
    expect(owned.ts.has('@cloudscape-design/chat-components')).toBe(false);
    // The iam auth branch it did not take.
    expect(owned.ts.has('aws4fetch')).toBe(false);
  });

  // The AG-UI packages arrive through `addAgUiReactConnection`, which only the
  // ag-ui protocol reaches — an http connection must not own them.
  it('should not own the AG-UI packages for an http connection', async () => {
    addProject(tree, 'website', {
      generator: 'ts#react-website',
      components: [
        {
          generator: 'ts#agent#react-connection',
          name: 'agent',
          protocol: 'http',
          auth: 'iam',
          theme: 'default',
        },
      ],
    } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('@trpc/client')).toBe(true);
    expect(owned.ts.has('@copilotkit/react-core')).toBe(false);
    expect(owned.ts.has('@ag-ui/client')).toBe(false);
  });

  // A generator spreads a helper's constant to claim the packages the helper
  // installs into its own project. Those are owned here even though this
  // generator installs none of them, or the sync would leave them behind.
  it('should own the dependencies its helpers install elsewhere', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);

    const owned = await ownedDependencies(tree);

    // `sharedConstructsGenerator` puts these in the shared constructs project.
    expect(owned.ts.has('aws-cdk-lib')).toBe(true);
    expect(owned.ts.has('constructs')).toBe(true);
  });

  it('should union the declarations of every generator that ran', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);
    addProject(tree, 'py', { generator: 'py#project' } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('zod')).toBe(true);
    expect(owned.py.has('ruff')).toBe(true);
  });
});

/** Calls that add a vended dependency, and so require a declaration. */
const ADDS_DEPENDENCIES =
  /withVersions\(|withPyVersions\(|addDependenciesToPyProjectToml\(|addDependenciesToDependencyGroupInPyProjectToml\(|addTsDependencies\(|addPyDependencies\(/;

/** Calls that record a generator against a project, making its deps discoverable. */
const RECORDS_METADATA =
  /addGeneratorMetadata\(|addComponentGeneratorMetadata\(|metadata: \{/;

/**
 * The explicit helpers. A connection wires into a project it did not create, so
 * an inline `metadata: {` in its source belongs to something else and doesn't
 * count.
 */
const CALLS_METADATA_HELPER =
  /addGeneratorMetadata\(|addComponentGeneratorMetadata\(/;

/**
 * Generators discovered through something they delegate to instead of their own
 * metadata: `preset` marks the workspace via `aws-nx-plugin.config.mts`, which
 * stands in for `init` (whose declaration therefore carries `husky`), and
 * `ts#dcr-proxy` creates its project through `ts#project`.
 */
const DISCOVERED_INDIRECTLY = new Set([
  'preset',
  'ts#dcr-proxy',
  // Dispatches to the specific connection generator, which records itself.
  'connection',
]);

/**
 * A generator that delegates to another module's generator must cover that
 * module's dependencies too, since they land in the workspace on its behalf.
 * Keyed by the delegating generator id.
 */
const DELEGATES_TO: Record<string, string> = {
  'ts#agent#react-connection': '../../ts/react-website/agui/generator.js',
  'py#agent#react-connection': '../../ts/react-website/agui/generator.js',
};

describe('declaration coverage', () => {
  // A generator that adds vended dependencies must declare them, or the version
  // sync would leave them behind. Generators that add none need no declaration.
  it('should have every generator that adds dependencies declare them', async () => {
    const undeclared: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const source = readFileSync(`${info.resolvedFactoryPath}.ts`, 'utf-8');
      const addsDependencies = ADDS_DEPENDENCIES.test(source);
      const module = await import(`${info.resolvedFactoryPath}.js`);
      if (addsDependencies && !module.DEPENDENCIES) {
        undeclared.push(info.id);
      }
    }

    expect(undeclared).toEqual([]);
  });

  // Declaring is not enough: the generator must also record itself against a
  // project, or `ownedDependencies` never discovers it and the deps it added are
  // silently left behind.
  it('should have every generator that adds dependencies record metadata', async () => {
    const unrecorded: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const source = readFileSync(`${info.resolvedFactoryPath}.ts`, 'utf-8');
      if (
        ADDS_DEPENDENCIES.test(source) &&
        !RECORDS_METADATA.test(source) &&
        !DISCOVERED_INDIRECTLY.has(info.id)
      ) {
        unrecorded.push(info.id);
      }
    }

    expect(unrecorded).toEqual([]);
  });

  // A helper reached through `MustDeclare` is checked by the compiler, but one
  // that just exports its own declaration is not — the caller has to union it.
  it('should cover the declarations of generators it delegates to', async () => {
    const uncovered: string[] = [];
    for (const [id, delegate] of Object.entries(DELEGATES_TO)) {
      const info = buildGeneratorInfoList(PLUGIN_ROOT).find((g) => g.id === id);
      const { DEPENDENCIES } = await import(`${info?.resolvedFactoryPath}.js`);
      const { DEPENDENCIES: delegated } = await import(delegate);
      const declared = new Set<string>(
        declaredNames<string>(DEPENDENCIES?.ts ?? []),
      );
      for (const dep of declaredNames<string>(delegated?.ts ?? [])) {
        if (!declared.has(dep)) {
          uncovered.push(`${id}: ${dep}`);
        }
      }
    }

    expect(uncovered).toEqual([]);
  });

  // Connections must be identifiable during an upgrade, whether or not they add
  // dependencies today — otherwise adding one later silently goes unowned.
  it('should have every connection generator record metadata', async () => {
    const unrecorded = buildGeneratorInfoList(PLUGIN_ROOT)
      .filter((info) => info.id.endsWith('-connection'))
      .filter((info) => !DISCOVERED_INDIRECTLY.has(info.id))
      .filter(
        (info) =>
          !CALLS_METADATA_HELPER.test(
            readFileSync(`${info.resolvedFactoryPath}.ts`, 'utf-8'),
          ),
      )
      .map((info) => info.id);

    expect(unrecorded).toEqual([]);
  });

  // A predicate that reads a field no project records can never hold, so its
  // dependency would silently stop being upgraded. Probing with an empty object
  // records which fields each predicate touches, then asserts the generator
  // records them.
  it('should record every field its predicates read', async () => {
    const unrecorded: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const { DEPENDENCIES } = await import(`${info.resolvedFactoryPath}.js`);
      const read = new Set<string>();
      const probe = new Proxy(
        {},
        {
          get: (_target, key) => {
            read.add(String(key));
            return undefined;
          },
          has: (_target, key) => {
            read.add(String(key));
            return false;
          },
        },
      );
      for (const entry of [
        ...(DEPENDENCIES?.ts ?? []),
        ...(DEPENDENCIES?.py ?? []),
      ]) {
        try {
          entry.when?.(probe);
        } catch {
          // A predicate that dereferences the undefined it got back still
          // recorded the field it read, which is all this needs.
        }
      }
      if (read.size === 0) {
        continue;
      }
      const source = readFileSync(`${info.resolvedFactoryPath}.ts`, 'utf-8');
      // The metadata interface the generator declares and hands to both the
      // dependency call and the recording helper. A field a predicate reads must
      // be one of its members, or no project will carry it.
      const declared = /interface \w*Metadata \{([^}]*)\}/.exec(source)?.[1];
      for (const key of read) {
        if (!declared || !new RegExp(`\\b${key}\\b`).test(declared)) {
          unrecorded.push(`${info.id}: ${key}`);
        }
      }
    }

    expect(unrecorded).toEqual([]);
  });

  /** Shared constants a helper adds to the project it owns, not the caller's. */
  const HELPER_CONSTANTS =
    /\.\.\.(?:ownedElsewhere\(|onlyWhen\()*([A-Z][A-Z0-9_]*_DEPENDENCIES(?:\.ts)?)\b/g;

  // A generator spreads a helper's constant to declare ownership, but the helper
  // adds those packages to its own project. Passing them to `addTsDependencies`
  // would install them into the caller's manifest — so they must be wrapped.
  it('should not install the dependencies its helpers own', async () => {
    const unwrapped: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const source = readFileSync(`${info.resolvedFactoryPath}.ts`, 'utf-8');
      if (!/addTsDependencies\(|addPyDependencies\(/.test(source)) {
        continue;
      }
      for (const [spread, constant] of source.matchAll(HELPER_CONSTANTS)) {
        // `ownedElsewhere` may wrap the constant directly or wrap an `onlyWhen`
        // that narrows it to the branch reaching the helper.
        if (!spread.startsWith('...ownedElsewhere(')) {
          unwrapped.push(`${info.id}: ${constant}`);
        }
      }
    }

    expect(unwrapped).toEqual([]);
  });

  it('should declare only packages the plugin vends', async () => {
    const unvended: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const { DEPENDENCIES } = await import(`${info.resolvedFactoryPath}.js`);
      for (const dep of declaredNames<string>(DEPENDENCIES?.ts ?? [])) {
        if (!(dep in TS_VERSIONS)) {
          unvended.push(`${info.id}: ${dep}`);
        }
      }
      for (const dep of declaredNames<string>(DEPENDENCIES?.py ?? [])) {
        if (!(dep in PY_VERSIONS)) {
          unvended.push(`${info.id}: ${dep}`);
        }
      }
    }

    expect(unvended).toEqual([]);
  });
});
