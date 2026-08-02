/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { relative } from 'node:path';
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  readJson,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator';
import { PY_AGENT_A2A_CONNECTION_GENERATOR_INFO } from '../../../py/agent/a2a-connection/generator';
import { PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO } from '../../../py/agent/gateway-connection/generator';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator';
import { PY_AGENT_MCP_CONNECTION_GENERATOR_INFO } from '../../../py/agent/mcp-connection/generator';
import { FAST_API_GENERATOR_INFO } from '../../../py/fast-api/generator';
import { FAST_API_REACT_GENERATOR_INFO } from '../../../py/fast-api/react/generator';
import { PY_MCP_SERVER_GENERATOR_INFO } from '../../../py/mcp-server/generator';
import { SMITHY_REACT_CONNECTION_GENERATOR_INFO } from '../../../smithy/react-connection/generator';
import { TS_SMITHY_API_GENERATOR_INFO } from '../../../smithy/ts/api/generator';
import { TRPC_BACKEND_GENERATOR_INFO } from '../../../trpc/backend/generator';
import { TRPC_REACT_GENERATOR_INFO } from '../../../trpc/react/generator';
import { TS_AGENT_A2A_CONNECTION_GENERATOR_INFO } from '../../../ts/agent/a2a-connection/generator';
import { TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO } from '../../../ts/agent/gateway-connection/generator';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator';
import { TS_AGENT_MCP_CONNECTION_GENERATOR_INFO } from '../../../ts/agent/mcp-connection/generator';
import { TS_DCR_PROXY_GENERATOR_INFO } from '../../../ts/dcr-proxy/generator';
import { TS_LIB_GENERATOR_INFO } from '../../../ts/lib/generator';
import { TS_MCP_SERVER_GENERATOR_INFO } from '../../../ts/mcp-server/generator';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator';
import {
  PY_CLIENT_NAMING,
  resolveAgentFramework,
} from '../../../utils/agent-connection/agent-connection';
import { matchGritQL } from '../../../utils/ast';
import { DCR_PROXY_HANDLERS } from '../../../utils/dcr-proxy-constructs/dcr-proxy-constructs';
import { formatFilesInSubtree } from '../../../utils/format';
import { toClassName } from '../../../utils/names';
import type { ComponentMetadata } from '../../../utils/nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Backfill the project metadata the version sync reads.
 *
 * The sync owns a generator's dependencies only for the runs it can see, and it
 * sees a run through the metadata that generator recorded — narrowing each run to
 * the branch it took by replaying the declaration's `when` predicates against that
 * metadata. Workspaces generated before this release recorded less, in three ways
 * that each cost ownership:
 *
 * - The agent connection generators recorded nothing at all, so the Layer-2
 *   clients' packages are invisible to the sync and would never move again.
 * - `ts#dcr-proxy` was attributed to the `ts#project` that creates its project.
 * - No project recorded an `iac`, and a predicate reading absent metadata counts
 *   as not applying, so the infrastructure helpers' packages go unowned.
 *
 * Every field is recovered from evidence the generators left behind — the files
 * they wrote, the clients they imported, the build dependencies they registered —
 * rather than guessed, and anything that can't be established is left alone and
 * reported. A wrong value is worse than a missing one: it has the sync claim
 * packages a project never received.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

type Iac = 'cdk' | 'terraform';

/** Metadata as a project records it, over the fields this backfill reads. */
interface ProjectMetadata {
  generator?: string;
  components?: ComponentMetadata[];
  iac?: string;
  tailwind?: boolean;
  tanstackRouter?: boolean;
  [key: string]: unknown;
}

/** The shared project each provider generates its infrastructure into. */
const SHARED_INFRA_ROOT: Record<Iac, string> = {
  cdk: joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
  terraform: joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR),
};

/**
 * The provider each project's infrastructure was generated with.
 *
 * Every infra helper registers `<project>:build` on the build target of the shared
 * project belonging to the provider it ran with, so those lists name exactly the
 * projects that received infrastructure, and which provider gave it to them.
 *
 * Read per project rather than per workspace because `iac` is a per-generator
 * option: one workspace can hold both providers.
 */
const infrastructureProviders = (tree: Tree): Map<string, Iac> => {
  const providers = new Map<string, Iac>();
  for (const iac of ['cdk', 'terraform'] as const) {
    const configPath = joinPathFragments(
      SHARED_INFRA_ROOT[iac],
      'project.json',
    );
    if (!tree.exists(configPath)) {
      continue;
    }
    const config = readJson<ProjectConfiguration>(tree, configPath);
    for (const dependency of config.targets?.build?.dependsOn ?? []) {
      // Registered as `<project>:build`, either as that string or as an object.
      const name =
        typeof dependency === 'string'
          ? dependency.split(':')[0]
          : (dependency.projects as string | undefined);
      if (name) {
        providers.set(name, iac);
      }
    }
  }
  return providers;
};

/**
 * Where a component's infrastructure lives under a provider's shared project,
 * keyed by the generator that created it.
 *
 * An agent and an MCP server are components of a project rather than projects, and
 * each records its own `iac` — so the project-level build dependency isn't precise
 * enough. Each gets a directory named after itself, which is.
 */
const COMPONENT_INFRA_DIR: Record<string, string> = {
  [TS_AGENT_GENERATOR_INFO.id]: 'agents',
  [PY_AGENT_GENERATOR_INFO.id]: 'agents',
  [TS_MCP_SERVER_GENERATOR_INFO.id]: 'mcp-servers',
  [PY_MCP_SERVER_GENERATOR_INFO.id]: 'mcp-servers',
};

/**
 * The provider a component's own infrastructure was generated with, from the
 * directory the infra helper created for it under one provider's shared project.
 *
 * The directory is named after the component, which for these generators is the
 * component's recorded name.
 */
const componentInfrastructureProvider = (
  tree: Tree,
  component: ComponentMetadata,
): Iac | undefined => {
  const appDirectory = component.generator
    ? COMPONENT_INFRA_DIR[component.generator]
    : undefined;
  if (!appDirectory || !component.name) {
    return undefined;
  }
  for (const iac of ['cdk', 'terraform'] as const) {
    if (
      tree.exists(
        joinPathFragments(
          SHARED_INFRA_ROOT[iac],
          'src',
          'app',
          appDirectory,
          component.name,
        ),
      )
    ) {
      return iac;
    }
  }
  return undefined;
};

/**
 * `ts#dcr-proxy` creates its handler project through `ts#project`, which recorded
 * its own id — so an existing workspace attributes the project to `ts#project` and
 * owns none of the proxy's dependencies. The six vended handlers are its
 * signature; a project carrying every one of them is a DCR proxy.
 */
const isDcrProxyProject = (tree: Tree, projectRoot: string): boolean =>
  DCR_PROXY_HANDLERS.every((handler) =>
    tree.exists(
      joinPathFragments(projectRoot, 'src', 'handlers', `${handler}.ts`),
    ),
  );

/**
 * Whether a website's vite config registers the given plugin, which is how
 * `tailwind` and `tanstackRouter` show up in a generated workspace: both default
 * to true, so only the config proves one was turned off.
 *
 * Matched on the AST rather than the text so the plugin's arguments, and any
 * reformatting since, don't hide it.
 */
const usesVitePlugin = (
  tree: Tree,
  projectRoot: string,
  plugin: string,
): Promise<boolean> =>
  matchGritQL(
    tree,
    joinPathFragments(projectRoot, 'vite.config.mts'),
    `\`${plugin}\``,
  );

/**
 * An agent connection generator, and how to recognise a run of it.
 *
 * A connection is found from the source agent it was made from: it imported a
 * client named after the target into that agent's entry point, so finding the
 * import establishes both that the connection exists and which target it reaches —
 * making `name` and `sourcePath` recovered facts rather than guesses.
 *
 * Only the agent connections are listed here; the website connections follow
 * below. The remaining connection generators — the rdb and dynamodb ones — add no
 * dependencies at all, so the sync would read them for nothing.
 */
interface AgentConnectionKind {
  /** The generator id to record. */
  readonly id: string;
  /** The generator that created a source agent of this connection. */
  readonly sourceGenerator: string;
  /** The generators that could have created its target. */
  readonly targetGenerators: readonly string[];
  /** The agent entry point this connection edits, within the source project. */
  readonly entryPoint: (source: ComponentMetadata) => string;
  /** The client it imports there, from the target's and source's recorded names. */
  readonly client: (
    targetClassName: string,
    source: ComponentMetadata,
  ) => string;
  /** GritQL prefix selecting the entry point's language. */
  readonly language?: string;
  /** What this connection records, which its own predicates read. */
  readonly metadata?: (source: ComponentMetadata) => Record<string, unknown>;
}

/** A TypeScript agent connection, which imports a Strands client into agent.ts. */
const tsAgentConnection = (
  id: string,
  targetGenerators: readonly string[],
): AgentConnectionKind => ({
  id,
  sourceGenerator: TS_AGENT_GENERATOR_INFO.id,
  targetGenerators,
  entryPoint: (source) => joinPathFragments(source.path ?? 'src', 'agent.ts'),
  client: (targetClassName) => `${targetClassName}ClientStrands`,
});

/**
 * A Python agent connection, whose client class is suffixed by the framework the
 * source agent was generated with — read from the naming table the generators
 * themselves use, so the name matched is the one that was written.
 */
const pyAgentConnection = (
  id: string,
  targetGenerators: readonly string[],
): AgentConnectionKind => ({
  id,
  sourceGenerator: PY_AGENT_GENERATOR_INFO.id,
  targetGenerators,
  entryPoint: (source) => joinPathFragments(source.path ?? 'src', 'agent.py'),
  client: (targetClassName, source) =>
    `${targetClassName}Client${
      PY_CLIENT_NAMING[resolveAgentFramework(source.framework)]
        .clientClassSuffix
    }`,
  language: 'python',
  metadata: (source) => ({
    framework: resolveAgentFramework(source.framework),
  }),
});

const AGENT_CONNECTION_KINDS: readonly AgentConnectionKind[] = [
  tsAgentConnection(TS_AGENT_MCP_CONNECTION_GENERATOR_INFO.id, [
    TS_MCP_SERVER_GENERATOR_INFO.id,
    PY_MCP_SERVER_GENERATOR_INFO.id,
  ]),
  tsAgentConnection(TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO.id, [
    AGENTCORE_GATEWAY_GENERATOR_INFO.id,
  ]),
  tsAgentConnection(TS_AGENT_A2A_CONNECTION_GENERATOR_INFO.id, [
    TS_AGENT_GENERATOR_INFO.id,
    PY_AGENT_GENERATOR_INFO.id,
  ]),
  pyAgentConnection(PY_AGENT_MCP_CONNECTION_GENERATOR_INFO.id, [
    TS_MCP_SERVER_GENERATOR_INFO.id,
    PY_MCP_SERVER_GENERATOR_INFO.id,
  ]),
  pyAgentConnection(PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO.id, [
    AGENTCORE_GATEWAY_GENERATOR_INFO.id,
  ]),
  pyAgentConnection(PY_AGENT_A2A_CONNECTION_GENERATOR_INFO.id, [
    TS_AGENT_GENERATOR_INFO.id,
    PY_AGENT_GENERATOR_INFO.id,
  ]),
];

/**
 * A website connection generator, and how to recognise a run of it.
 *
 * Each vends a provider component named after the API or agent it connects to, so
 * the file's presence in the website establishes both the connection and its
 * target. The values its predicates read come from the target project's own
 * metadata, which these workspaces already recorded.
 */
interface WebsiteConnectionKind {
  /** The generator id to record. */
  readonly id: string;
  /** The generators that could have created its target. */
  readonly targetGenerators: readonly string[];
  /** The provider component it vends, from the target's recorded name. */
  readonly provider: (targetClassName: string) => string;
  /** What this connection records, from the target project's metadata. */
  readonly metadata?: (target: ProjectMetadata) => Record<string, unknown>;
}

/** The tRPC-over-HTTP integration patterns, whose extra client packages differ. */
const REST_API_INFRA = new Set(['rest-lambda', 'serverlessapigatewayrestapi']);

const WEBSITE_CONNECTION_KINDS: readonly WebsiteConnectionKind[] = [
  {
    id: TRPC_REACT_GENERATOR_INFO.id,
    targetGenerators: [TRPC_BACKEND_GENERATOR_INFO.id],
    provider: (targetClassName) => `${targetClassName}ClientProvider`,
    metadata: (target) => ({
      auth: String(target.auth ?? 'iam').toLowerCase(),
      isRestApi: REST_API_INFRA.has(
        String(target.infra ?? target.computeType ?? '').toLowerCase(),
      ),
    }),
  },
  // Both OpenAPI react clients vend the same provider shape, and neither records
  // anything the sync narrows on.
  {
    id: SMITHY_REACT_CONNECTION_GENERATOR_INFO.id,
    targetGenerators: [TS_SMITHY_API_GENERATOR_INFO.id],
    provider: (targetClassName) => `${targetClassName}Provider`,
  },
  {
    id: FAST_API_REACT_GENERATOR_INFO.id,
    targetGenerators: [FAST_API_GENERATOR_INFO.id],
    provider: (targetClassName) => `${targetClassName}Provider`,
  },
];

/**
 * A thing in the workspace a connection could have been made to, by the name its
 * client or provider is generated from.
 */
interface ConnectionTarget {
  /** The class name the connection's generated code is named after. */
  readonly className: string;
  /** The metadata of the project it belongs to, which its fields come from. */
  readonly project: ProjectMetadata;
}

/**
 * Every connection target in the workspace, keyed by the generator that created
 * it.
 *
 * A target may be a component of a project (an agent, an MCP server) or a whole
 * project (a gateway, an API), so both are indexed. Agents and MCP servers record
 * the class name directly as `rc`; an API's is derived from its `apiName` the same
 * way its connection generator derives it.
 */
const connectionTargets = (tree: Tree): Map<string, ConnectionTarget[]> => {
  const targets = new Map<string, ConnectionTarget[]>();
  const add = (
    generator: string | undefined,
    className: string | undefined,
    project: ProjectMetadata,
  ) => {
    if (!generator || !className) {
      return;
    }
    targets.set(generator, [
      ...(targets.get(generator) ?? []),
      { className, project },
    ]);
  };
  for (const [, project] of getProjects(tree)) {
    const metadata = project.metadata as ProjectMetadata | undefined;
    if (!metadata) {
      continue;
    }
    add(
      metadata.generator,
      typeof metadata.rc === 'string'
        ? metadata.rc
        : typeof metadata.apiName === 'string'
          ? toClassName(metadata.apiName)
          : undefined,
      metadata,
    );
    for (const component of metadata.components ?? []) {
      add(
        component.generator,
        typeof component.rc === 'string' ? component.rc : undefined,
        metadata,
      );
    }
  }
  return targets;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const providers = infrastructureProviders(tree);
  const targets = connectionTargets(tree);

  for (const [projectName, project] of getProjects(tree)) {
    const metadata = project.metadata as ProjectMetadata | undefined;
    if (!metadata?.generator && !metadata?.components?.length) {
      // Not a project this plugin generated, so none of this is ours to record.
      continue;
    }

    const next: ProjectMetadata = { ...metadata };
    let changed = false;

    if (
      next.generator === TS_LIB_GENERATOR_INFO.id &&
      isDcrProxyProject(tree, project.root)
    ) {
      next.generator = TS_DCR_PROXY_GENERATOR_INFO.id;
      changed = true;
    }

    // The provider this project's infrastructure was generated with. Left unset
    // where the project received none, matching what the generators record: the
    // sync reads a set `iac` as "infrastructure was generated", and would claim
    // the helpers' packages for a project that never got them.
    const iac = providers.get(projectName);
    if (iac && next.iac === undefined) {
      next.iac = iac;
      changed = true;
    }

    if (next.generator === REACT_WEBSITE_APP_GENERATOR_INFO.id) {
      if (next.tailwind === undefined) {
        next.tailwind = await usesVitePlugin(tree, project.root, 'tailwindcss');
        changed = true;
      }
      if (next.tanstackRouter === undefined) {
        next.tanstackRouter = await usesVitePlugin(
          tree,
          project.root,
          'tanstackRouter',
        );
        changed = true;
      }
    }

    // The provider each of this project's components generated with. Recorded on
    // the component because that is where these generators record it — an agent
    // and an MCP server each choose their own provider.
    next.components = (next.components ?? []).map((component) => {
      if (component.iac !== undefined) {
        return component;
      }
      const componentIac = componentInfrastructureProvider(tree, component);
      if (!componentIac) {
        return component;
      }
      changed = true;
      return { ...component, iac: componentIac };
    });

    // A connection already recorded is left as it is: re-recording it would
    // duplicate the entry, and the sync counts entries.
    const recorded = new Set(
      (next.components ?? []).map(
        (component) => `${component.generator}:${component.name}`,
      ),
    );
    const record = (component: ComponentMetadata) => {
      next.components = [...(next.components ?? []), component];
      recorded.add(`${component.generator}:${component.name}`);
      changed = true;
    };
    const candidatesFor = (generators: readonly string[]) =>
      generators.flatMap((generator) => targets.get(generator) ?? []);

    // The agent connections made from this project's agents, each found by the
    // client it imported into its source agent.
    for (const kind of AGENT_CONNECTION_KINDS) {
      const sources = (next.components ?? []).filter(
        (component) => component.generator === kind.sourceGenerator,
      );
      const candidates = candidatesFor(kind.targetGenerators);
      for (const source of sources) {
        const relativeEntryPoint = kind.entryPoint(source);
        const entryPoint = joinPathFragments(project.root, relativeEntryPoint);
        if (!tree.exists(entryPoint)) {
          continue;
        }
        for (const target of candidates) {
          if (recorded.has(`${kind.id}:${target.className}`)) {
            continue;
          }
          const pattern = `\`${kind.client(target.className, source)}\``;
          if (
            !(await matchGritQL(
              tree,
              entryPoint,
              kind.language ? `language ${kind.language}\n${pattern}` : pattern,
            ))
          ) {
            continue;
          }
          record({
            generator: kind.id,
            path: relativeEntryPoint,
            name: target.className,
            ...(source.path ? { sourcePath: source.path } : {}),
            ...kind.metadata?.(source),
          });
        }
      }
    }

    // The connections made from this website, each found by the provider
    // component it vends for its target.
    if (next.generator === REACT_WEBSITE_APP_GENERATOR_INFO.id) {
      const sourceRoot =
        project.sourceRoot ?? joinPathFragments(project.root, 'src');
      for (const kind of WEBSITE_CONNECTION_KINDS) {
        for (const target of candidatesFor(kind.targetGenerators)) {
          if (recorded.has(`${kind.id}:${target.className}`)) {
            continue;
          }
          const provider = joinPathFragments(
            'components',
            kind.provider(target.className),
          );
          if (!tree.exists(joinPathFragments(sourceRoot, `${provider}.tsx`))) {
            continue;
          }
          record({
            generator: kind.id,
            path: joinPathFragments(
              relative(project.root, sourceRoot),
              provider,
            ),
            name: target.className,
            ...kind.metadata?.(target.project),
          });
        }
      }
    }

    if (changed) {
      // Keep metadata before targets so the serialized key order matches what the
      // generators write, leaving this a pure metadata edit.
      const { targets: projectTargets, ...rest } = project;
      updateProjectConfiguration(tree, projectName, {
        ...rest,
        metadata: next as ProjectConfiguration['metadata'],
        ...(projectTargets ? { targets: projectTargets } : {}),
      });
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps: [] };
}
