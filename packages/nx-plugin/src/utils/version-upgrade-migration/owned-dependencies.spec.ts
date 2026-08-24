/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureAllGritQL, matchGritQL } from '../ast.js';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../config/utils.js';
import { declaredNames } from '../declared-dependencies.js';
import { buildGeneratorInfoList } from '../generators.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import { PY_VERSIONS, TS_VERSIONS } from '../versions.js';
import {
  generatorsRun,
  ownedDependencies,
  PLUGIN_ROOT,
} from './owned-dependencies.js';

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
    addProject(tree, 'api', {
      generator: 'ts#trpc-api',
      iac: 'cdk',
    } as never);

    const owned = await ownedDependencies(tree);

    // `sharedConstructsGenerator` puts these in the shared constructs project.
    expect(owned.ts.has('aws-cdk-lib')).toBe(true);
    expect(owned.ts.has('constructs')).toBe(true);
  });

  // The packages an infra helper adds only reach a project that asked for
  // infrastructure, so one generated without it must claim none of them.
  it('should not own infrastructure packages for a project with no infra', async () => {
    addProject(tree, 'api', {
      generator: 'ts#trpc-api',
      infra: 'none',
    } as never);

    const owned = await ownedDependencies(tree);

    // `addApiGatewayInfra` and `sharedConstructsGenerator` never ran.
    expect(owned.ts.has('@aws-sdk/client-api-gateway')).toBe(false);
    expect(owned.ts.has('@aws-sdk/client-iam')).toBe(false);
    expect(owned.ts.has('aws-cdk-lib')).toBe(false);
    // What the generator adds itself is still owned.
    expect(owned.ts.has('zod')).toBe(true);
  });

  // `sharedConstructsGenerator` only creates the TypeScript constructs project
  // on the CDK branch, so a Terraform workspace never receives those packages.
  it('should not own the CDK packages for a terraform project', async () => {
    addProject(tree, 'api', {
      generator: 'ts#trpc-api',
      iac: 'terraform',
    } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('aws-cdk-lib')).toBe(false);
    expect(owned.ts.has('constructs')).toBe(false);
    // Everything the generator adds itself is still owned.
    expect(owned.ts.has('zod')).toBe(true);
  });

  it('should union the declarations of every generator that ran', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);
    addProject(tree, 'py', { generator: 'py#project' } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('zod')).toBe(true);
    expect(owned.py.has('ruff')).toBe(true);
  });
});

/**
 * A generator's source, on a tree so it can be queried with GritQL.
 *
 * Matching the syntax rather than the text means a call inside a comment or a
 * string can't satisfy an invariant, and a rename shows up as a miss instead of
 * quietly still matching.
 */
/** Where a shared metadata interface a generator extends is declared. */
const SHARED_METADATA_PATH = 'shared-metadata.ts';

const generatorSource = (
  info: { resolvedFactoryPath: string },
  tree: Tree,
): string => {
  tree.write(
    SHARED_METADATA_PATH,
    readFileSync(
      join(PLUGIN_ROOT, 'src/utils/shared-constructs-constants.ts'),
      'utf-8',
    ),
  );
  const path = 'generator-under-test.ts';
  tree.write(path, readFileSync(`${info.resolvedFactoryPath}.ts`, 'utf-8'));
  return path;
};

/**
 * The property names of the generator's `*Metadata` interface — the fields it
 * hands to both the dependency call and the recording helper.
 *
 * Captured in two passes because a `within` clause doesn't reach a property
 * signature: the interface first, then its members from that text alone.
 */
const metadataInterfaceMembers = async (
  path: string,
  tree: Tree,
): Promise<string[]> => {
  const interfaces = await captureAllGritQL(
    tree,
    path,
    'interface_declaration($name, $body) where { $name <: r".*Metadata" }',
  );
  if (interfaces.length === 0) {
    return [];
  }
  // A generator's interface may extend a shared one — `IacMetadata`, say — whose
  // members are just as recorded, so pull those in too.
  const inherited = await Promise.all(
    interfaces
      .flatMap((declaration) =>
        [...declaration.matchAll(/\bextends\s+([\w,\s]+?)\s*\{/g)].flatMap(
          (match) => match[1].split(',').map((name) => name.trim()),
        ),
      )
      .filter((name) => name && !name.endsWith('GeneratorSchema'))
      .map((name) =>
        captureAllGritQL(
          tree,
          SHARED_METADATA_PATH,
          `interface_declaration($name, $body) where { $name <: \`${name}\` }`,
        ),
      ),
  );
  interfaces.push(...inherited.flat());
  const membersPath = 'metadata-interfaces.ts';
  tree.write(membersPath, interfaces.join('\n'));
  const signatures = await captureAllGritQL(
    tree,
    membersPath,
    'property_signature($name)',
  );
  return signatures.map((signature) =>
    signature
      .split(/[?:]/)[0]
      .trim()
      .replace(/^readonly\s+/, ''),
  );
};

/**
 * Property names a generator passes to a metadata helper directly, for the ones
 * that record a field without declaring an interface for it.
 */
const recordedPropertyNames = async (
  path: string,
  tree: Tree,
): Promise<string[]> => {
  const names: string[] = [];
  for (const helper of METADATA_HELPERS) {
    const calls = await captureAllGritQL(
      tree,
      path,
      `call_expression($function) as $call where { $function <: \`${helper}\` }`,
    );
    for (const call of calls) {
      // The metadata argument is an object literal, so its keys are the fields.
      for (const [, key] of call.matchAll(/[{,]\s*(\w+)\s*[,:}]/g)) {
        names.push(key);
      }
    }
  }
  return names;
};

/** Whether the source contains a call to any of the named functions. */
const callsAny = async (
  tree: Tree,
  path: string,
  names: readonly string[],
): Promise<boolean> => {
  for (const name of names) {
    // Matched as a call expression rather than a template: an argument-list
    // pattern doesn't match a multi-argument call.
    if (
      await matchGritQL(
        tree,
        path,
        `call_expression($function) where { $function <: \`${name}\` }`,
      )
    ) {
      return true;
    }
  }
  return false;
};

/** Calls that add a vended dependency, and so require a declaration. */
const ADDS_DEPENDENCIES = [
  'withVersions',
  'withPyVersions',
  'addDependenciesToPyProjectToml',
  'addDependenciesToDependencyGroupInPyProjectToml',
  'addTsDependencies',
  'addPyDependencies',
] as const;

/** The helpers that record a generator against a project. */
const METADATA_HELPERS = [
  'addGeneratorMetadata',
  'addComponentGeneratorMetadata',
] as const;

/**
 * Generators discovered through something they delegate to instead of their own
 * metadata: `preset` marks the workspace via `aws-nx-plugin.config.mts`, which
 * stands in for `init` (whose declaration therefore carries `husky`).
 */
const DISCOVERED_INDIRECTLY = new Set([
  'preset',
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
    const sourceTree = createTreeUsingTsSolutionSetup();
    const undeclared: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const path = generatorSource(info, sourceTree);
      const addsDependencies = await callsAny(
        sourceTree,
        path,
        ADDS_DEPENDENCIES,
      );
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
    const sourceTree = createTreeUsingTsSolutionSetup();
    const unrecorded: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      if (DISCOVERED_INDIRECTLY.has(info.id)) {
        continue;
      }
      const path = generatorSource(info, sourceTree);
      // A generator that creates the project may record itself by building the
      // metadata inline, so an object with a `generator` property counts too.
      const records =
        (await callsAny(sourceTree, path, METADATA_HELPERS)) ||
        (await matchGritQL(sourceTree, path, '`metadata: { $$$ }`'));
      if ((await callsAny(sourceTree, path, ADDS_DEPENDENCIES)) && !records) {
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
    const sourceTree = createTreeUsingTsSolutionSetup();
    const unrecorded: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      if (
        !info.id.endsWith('-connection') ||
        DISCOVERED_INDIRECTLY.has(info.id)
      ) {
        continue;
      }
      // A connection wires into a project it did not create, so only an explicit
      // helper call counts — inline metadata there belongs to something else.
      const path = generatorSource(info, sourceTree);
      if (!(await callsAny(sourceTree, path, METADATA_HELPERS))) {
        unrecorded.push(info.id);
      }
    }

    expect(unrecorded).toEqual([]);
  });

  // Both ends of a component-to-component connection must be identifiable: the
  // recorded project and target path alone can't say which of several components
  // on that project is wired up, so the source's path is recorded too.
  it('should record the source path of a component connection', async () => {
    const sourceTree = createTreeUsingTsSolutionSetup();
    const missing: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      if (!info.id.endsWith('-connection')) {
        continue;
      }
      const path = generatorSource(info, sourceTree);
      // Only a connection whose source is itself a component has one to name.
      const readsSourceComponent = await matchGritQL(
        sourceTree,
        path,
        '`options.sourceComponent`',
      );
      if (!readsSourceComponent) {
        continue;
      }
      if (!(await matchGritQL(sourceTree, path, '`sourcePath`'))) {
        missing.push(info.id);
      }
    }

    expect(missing).toEqual([]);
  });

  // A predicate that reads a field no project records can never hold, so its
  // dependency would silently stop being upgraded. Probing with an empty object
  // records which fields each predicate touches, then asserts the generator
  // records them.
  it('should record every field its predicates read', async () => {
    const sourceTree = createTreeUsingTsSolutionSetup();
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
      // The metadata interface the generator declares and hands to both the
      // dependency call and the recording helper. A field a predicate reads must
      // be one of its members, or no project will carry it.
      const path = generatorSource(info, sourceTree);
      const members = new Set([
        ...(await metadataInterfaceMembers(path, sourceTree)),
        // A generator with no metadata interface may still record a field by
        // passing it to the helper directly, which counts just as much.
        ...(await recordedPropertyNames(path, sourceTree)),
      ]);
      for (const key of read) {
        if (!members.has(key)) {
          unrecorded.push(`${info.id}: ${key}`);
        }
      }
    }

    expect(unrecorded).toEqual([]);
  });

  /** A helper's exported constant, named `*_DEPENDENCIES` by convention. */
  const HELPER_CONSTANT = /^[A-Z][A-Z0-9_]*_DEPENDENCIES$/;

  // A generator spreads a helper's constant to declare ownership, but the helper
  // adds those packages to its own project. Passing them to `addTsDependencies`
  // would install them into the caller's manifest — so they must be wrapped.
  it('should not install the dependencies its helpers own', async () => {
    const sourceTree = createTreeUsingTsSolutionSetup();
    const unwrapped: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const path = generatorSource(info, sourceTree);
      if (
        !(await callsAny(sourceTree, path, [
          'addTsDependencies',
          'addPyDependencies',
        ]))
      ) {
        continue;
      }
      // Every spread in the declaration, so a helper's constant can be checked
      // for its `ownedElsewhere` wrapper. `ownedElsewhere` may wrap the constant
      // directly or wrap an `onlyWhen` narrowing it to one branch.
      for (const spread of await captureAllGritQL(
        sourceTree,
        path,
        '`...$spread`',
      )) {
        const constant = spread
          .replace(/^\.\.\./, '')
          .replace(/^(?:ownedElsewhere|onlyWhen)\(/, '')
          .replace(/\.ts\b.*$/, '')
          .replace(/[(),].*$/s, '')
          .trim();
        if (!HELPER_CONSTANT.test(constant)) {
          continue;
        }
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
