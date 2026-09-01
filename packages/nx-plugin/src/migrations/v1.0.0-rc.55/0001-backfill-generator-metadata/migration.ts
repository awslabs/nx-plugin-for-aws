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
import { AGENTCORE_GATEWAY_GATEWAY_CONNECTION_GENERATOR_INFO } from '../../../agentcore-gateway/gateway-connection/generator.js';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator.js';
import { AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO } from '../../../agentcore-gateway/mcp-connection/generator.js';
import { PY_AGENT_A2A_CONNECTION_GENERATOR_INFO } from '../../../py/agent/a2a-connection/generator.js';
import { PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO } from '../../../py/agent/gateway-connection/generator.js';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator.js';
import { PY_AGENT_MCP_CONNECTION_GENERATOR_INFO } from '../../../py/agent/mcp-connection/generator.js';
import { PY_AGENT_REACT_CONNECTION_GENERATOR_INFO } from '../../../py/agent/react-connection/generator.js';
import { PY_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO } from '../../../py/dynamodb/agent-connection/generator.js';
import { PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO } from '../../../py/dynamodb/fast-api-connection/generator.js';
import { PY_DYNAMODB_GENERATOR_INFO } from '../../../py/dynamodb/generator.js';
import { PY_DYNAMODB_MCP_SERVER_CONNECTION_GENERATOR_INFO } from '../../../py/dynamodb/mcp-server-connection/generator.js';
import { FAST_API_GENERATOR_INFO } from '../../../py/fast-api/generator.js';
import { FAST_API_REACT_GENERATOR_INFO } from '../../../py/fast-api/react/generator.js';
import { LAMBDA_FUNCTION_GENERATOR_INFO as PY_LAMBDA_FUNCTION_GENERATOR_INFO } from '../../../py/lambda-function/generator.js';
import { PY_MCP_SERVER_GENERATOR_INFO } from '../../../py/mcp-server/generator.js';
import { PY_RDB_AGENT_CONNECTION_GENERATOR_INFO } from '../../../py/rdb/agent-connection/generator.js';
import { PY_RDB_FAST_API_CONNECTION_GENERATOR_INFO } from '../../../py/rdb/fast-api-connection/generator.js';
import { PY_RDB_GENERATOR_INFO } from '../../../py/rdb/generator.js';
import { PY_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO } from '../../../py/rdb/mcp-server-connection/generator.js';
import { SMITHY_PROJECT_GENERATOR_INFO } from '../../../smithy/project/generator.js';
import { SMITHY_REACT_CONNECTION_GENERATOR_INFO } from '../../../smithy/react-connection/generator.js';
import { TS_SMITHY_API_GENERATOR_INFO } from '../../../smithy/ts/api/generator.js';
import { TRPC_BACKEND_GENERATOR_INFO } from '../../../trpc/backend/generator.js';
import { TRPC_REACT_GENERATOR_INFO } from '../../../trpc/react/generator.js';
import { TS_AGENT_A2A_CONNECTION_GENERATOR_INFO } from '../../../ts/agent/a2a-connection/generator.js';
import { TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO } from '../../../ts/agent/gateway-connection/generator.js';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator.js';
import { TS_AGENT_MCP_CONNECTION_GENERATOR_INFO } from '../../../ts/agent/mcp-connection/generator.js';
import { TS_AGENT_REACT_CONNECTION_GENERATOR_INFO } from '../../../ts/agent/react-connection/generator.js';
import { TS_DCR_PROXY_GENERATOR_INFO } from '../../../ts/dcr-proxy/generator.js';
import { TS_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO } from '../../../ts/dynamodb/agent-connection/generator.js';
import { TS_DYNAMODB_GENERATOR_INFO } from '../../../ts/dynamodb/generator.js';
import { TS_DYNAMODB_MCP_SERVER_CONNECTION_GENERATOR_INFO } from '../../../ts/dynamodb/mcp-server-connection/generator.js';
import { TS_DYNAMODB_SMITHY_CONNECTION_GENERATOR_INFO } from '../../../ts/dynamodb/smithy-connection/generator.js';
import { TS_DYNAMODB_TRPC_CONNECTION_GENERATOR_INFO } from '../../../ts/dynamodb/trpc-connection/generator.js';
import { TS_LAMBDA_FUNCTION_GENERATOR_INFO } from '../../../ts/lambda-function/generator.js';
import { TS_LIB_GENERATOR_INFO } from '../../../ts/lib/generator.js';
import { TS_MCP_SERVER_GENERATOR_INFO } from '../../../ts/mcp-server/generator.js';
import { TS_RDB_AGENT_CONNECTION_GENERATOR_INFO } from '../../../ts/rdb/agent-connection/generator.js';
import { TS_RDB_GENERATOR_INFO } from '../../../ts/rdb/generator.js';
import { TS_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO } from '../../../ts/rdb/mcp-server-connection/generator.js';
import { TS_RDB_SMITHY_CONNECTION_GENERATOR_INFO } from '../../../ts/rdb/smithy-connection/generator.js';
import { TS_RDB_TRPC_CONNECTION_GENERATOR_INFO } from '../../../ts/rdb/trpc-connection/generator.js';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { COGNITO_AUTH_GENERATOR_INFO } from '../../../ts/react-website/cognito-auth/generator.js';
import {
  PY_CLIENT_NAMING,
  resolveAgentFramework,
} from '../../../utils/agent-connection/agent-connection.js';
import { matchGritQL } from '../../../utils/ast.js';
import { DCR_PROXY_HANDLERS } from '../../../utils/dcr-proxy-constructs/dcr-proxy-constructs.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  camelCase,
  kebabCase,
  pascalCase,
  toClassName,
  toSnakeCase,
} from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Backfill the project metadata the version sync reads.
 *
 * The sync owns a generator's dependencies only for the runs it can see, and it
 * sees a run through the metadata that generator recorded — narrowing each run to
 * the branch it took by replaying the declaration's `when` predicates against that
 * metadata. Workspaces generated before this release recorded less, in three ways
 * that each cost ownership:
 *
 * - No connection generator recorded anything at all, so the packages they add
 *   (the agent Layer-2 clients, AG-UI, the tRPC and OpenAPI react clients) are
 *   invisible to the sync and their versions would never move again.
 * - `ts#dcr-proxy` was attributed to the `ts#project` that creates its project.
 * - No project recorded an `iac`, and a predicate reading absent metadata counts
 *   as not applying, so the infrastructure helpers' packages go unowned.
 *
 * Every connection is recorded, including those that add no dependencies today.
 * The sync reads the recorded metadata rather than the generators, so a connection
 * recorded now is picked up the moment its generator starts owning packages —
 * otherwise a later release needs a second backfill for the workspaces this one
 * already ran on.
 *
 * Every field is recovered from evidence the generators left behind — the files
 * they wrote, the clients they imported, the dev chains and build dependencies they
 * registered — rather than guessed, and anything that can't be established is left
 * alone. A wrong value is worse than a missing one: it has the sync claim packages
 * a project never received.
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
  smithyType?: string;
  namespace?: string;
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
 * These components belong to a project rather than being one, and each records its
 * own `iac` — a project can hold a CDK-deployed agent alongside one generated with
 * `infra: 'none'` — so the project-level build dependency isn't precise enough.
 * Each component gets its own entry under the app directory below, which is.
 *
 * `paths` lists the candidates because the two providers don't lay out every
 * component the same way: a Lambda function is one CDK file but a Terraform
 * directory.
 */
const COMPONENT_INFRA: Record<
  string,
  { readonly appDirectory: string; readonly paths: (name: string) => string[] }
> = {
  ...Object.fromEntries(
    (
      [
        [TS_AGENT_GENERATOR_INFO.id, 'agents'],
        [PY_AGENT_GENERATOR_INFO.id, 'agents'],
        [TS_MCP_SERVER_GENERATOR_INFO.id, 'mcp-servers'],
        [PY_MCP_SERVER_GENERATOR_INFO.id, 'mcp-servers'],
      ] as const
    ).map(([id, appDirectory]) => [
      id,
      { appDirectory, paths: (name: string) => [name] },
    ]),
  ),
  ...Object.fromEntries(
    [
      TS_LAMBDA_FUNCTION_GENERATOR_INFO.id,
      PY_LAMBDA_FUNCTION_GENERATOR_INFO.id,
    ].map((id) => [
      id,
      {
        appDirectory: 'lambda-functions',
        // CDK vends `<name>.ts`; Terraform vends `<name>/<name>.tf`.
        paths: (name: string) => [`${name}.ts`, name],
      },
    ]),
  ),
};

/**
 * The provider a component's own infrastructure was generated with, from the entry
 * the infra helper created for it under one provider's shared project.
 *
 * That entry is named after the component, which for these generators is the name
 * the component records.
 */
const componentInfrastructureProvider = (
  tree: Tree,
  component: ComponentMetadata,
): Iac | undefined => {
  const layout = component.generator
    ? COMPONENT_INFRA[component.generator]
    : undefined;
  if (!layout || !component.name) {
    return undefined;
  }
  for (const iac of ['cdk', 'terraform'] as const) {
    for (const entry of layout.paths(component.name)) {
      if (
        tree.exists(
          joinPathFragments(
            SHARED_INFRA_ROOT[iac],
            'src',
            'app',
            layout.appDirectory,
            entry,
          ),
        )
      ) {
        return iac;
      }
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
 * What a Smithy project models, from the `smithy-build.json` each kind gets: a
 * service builds an OpenAPI spec and a TypeScript SSDK from its model, so it has
 * the plugins to do so, while a shape library only shares shapes and has none.
 */
const smithyProjectType = (
  tree: Tree,
  projectRoot: string,
): 'service' | 'shapes' | undefined => {
  const buildPath = joinPathFragments(projectRoot, 'smithy-build.json');
  if (!tree.exists(buildPath)) {
    return undefined;
  }
  const build = readJson<{ plugins?: Record<string, unknown> }>(
    tree,
    buildPath,
  );
  return build.plugins && Object.keys(build.plugins).length > 0
    ? 'service'
    : 'shapes';
};

/**
 * The Smithy namespace a project's shapes are declared in, read from the model
 * rather than derived from the npm scope: the generator takes it as an option, so
 * a project may not carry the default.
 */
const smithyNamespace = (
  tree: Tree,
  project: ProjectConfiguration,
): string | undefined => {
  const modelPath = joinPathFragments(
    project.sourceRoot ?? joinPathFragments(project.root, 'src'),
    'main.smithy',
  );
  if (!tree.exists(modelPath)) {
    return undefined;
  }
  // Smithy is not a language GritQL parses, and `namespace <x>` is a single
  // declaration on its own line rather than a structure worth an AST for.
  return /^namespace\s+(\S+)\s*$/m
    .exec(tree.read(modelPath, 'utf-8') ?? '')
    ?.at(1);
};

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
 * A connection generator, and how to recognise a run of it.
 *
 * A connection is found from the source component it was made from and the target
 * it reaches: `evidence` is a check that only passes if that exact pair was wired
 * up — a client import named after the target, a vended file named after it, or
 * the dev-target dependency on its project. So `name` and `sourcePath` are
 * recovered facts rather than guesses.
 *
 * Every connection generator is listed, including those that add no dependencies
 * today. The sync reads the metadata rather than the generator, so recording a
 * connection now is what lets it be picked up the moment its generator starts
 * owning packages — a later release would otherwise need another backfill.
 */
interface ConnectionKind {
  /** The generator id to record. */
  readonly id: string;
  /**
   * The generator that created a source component of this connection, or
   * undefined when the connection is made from the project as a whole.
   */
  readonly sourceGenerator?: string;
  /** The generators that could have created its target. */
  readonly targetGenerators: readonly string[];
  /**
   * Whether this connection was made from `source` to `target`, and what to record
   * as the component's `path` if so. Undefined means it was not.
   */
  readonly evidence: (
    context: ConnectionContext,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * The `name` this connection records, when it is not the target's class name.
   * Matched to what each generator writes so a re-run recognises its own entry.
   */
  readonly recordedName?: (context: ConnectionContext) => string;
  /** What this connection records beyond the path, which its predicates read. */
  readonly metadata?: (
    context: ConnectionContext,
  ) => Record<string, unknown> | undefined;
}

/** `<sourceComponent>-<target>`, the name the database connections record. */
const sourceQualifiedName =
  (target: (context: ConnectionContext) => string, fallback: string) =>
  (context: ConnectionContext) =>
    `${context.source.name ?? fallback}-${target(context)}`;

/** The database name as each language's connections case it. */
const camelDatabase = ({ target }: ConnectionContext) =>
  camelCase(target.databaseName);
const targetProjectName = ({ target }: ConnectionContext) => target.projectName;

/** What a connection's evidence check has to work from. */
interface ConnectionContext {
  readonly tree: Tree;
  /** The project the connection lives on — the source side. */
  readonly project: ProjectConfiguration;
  /**
   * The source component, or the project's own metadata standing in for it when
   * the connection is made from the project as a whole.
   */
  readonly source: ComponentMetadata;
  /** The target being connected to. */
  readonly target: ConnectionTarget;
}

/** Prefix a GritQL pattern to match against Python rather than TypeScript. */
const py = (pattern: string) => `language python\n${pattern}`;

/**
 * Whether the source project's `dev` chain runs the target project's, which every
 * connection wires up so `nx run <source>:dev` starts what it depends on.
 *
 * This is the only trace left by the connections that vend no code (the DynamoDB
 * ones grant IAM in the target's infrastructure instead). It identifies the pair
 * because the dependency names the target project.
 */
const dependsOnTargetDev = (
  project: ProjectConfiguration,
  target: ConnectionTarget,
  devTarget: string,
): boolean =>
  (project.targets?.[devTarget]?.dependsOn ?? []).some((dependency) => {
    const projects =
      typeof dependency === 'string'
        ? dependency.split(':')[0]
        : (dependency.projects as string | string[] | undefined);
    return Array.isArray(projects)
      ? projects.includes(target.projectName)
      : projects === target.projectName;
  });

/**
 * An agent-to-service connection, which imports a Layer-2 client named after the
 * target into the source agent's entry point.
 */
const agentClientConnection = (
  id: string,
  language: 'ts' | 'py',
  targetGenerators: readonly string[],
): ConnectionKind => ({
  id,
  sourceGenerator:
    language === 'ts' ? TS_AGENT_GENERATOR_INFO.id : PY_AGENT_GENERATOR_INFO.id,
  targetGenerators,
  evidence: async ({ tree, project, source, target }) => {
    const path = joinPathFragments(
      source.path ?? 'src',
      language === 'ts' ? 'agent.ts' : 'agent.py',
    );
    // The Python client's class suffix follows the source agent's framework, read
    // from the same naming table the generators use.
    const client =
      language === 'ts'
        ? `${target.className}ClientStrands`
        : `${target.className}Client${
            PY_CLIENT_NAMING[resolveAgentFramework(source.framework)]
              .clientClassSuffix
          }`;
    const pattern = `\`${client}\``;
    return (await matchGritQL(
      tree,
      joinPathFragments(project.root, path),
      language === 'ts' ? pattern : py(pattern),
    ))
      ? path
      : undefined;
  },
  ...(language === 'py'
    ? {
        metadata: ({ source }) => ({
          framework: resolveAgentFramework(source.framework),
        }),
      }
    : {}),
});

/**
 * A database-to-component connection, which imports the database's client getter
 * into the component it connects to and aliases it after the database.
 */
const rdbConnection = (
  id: string,
  options: {
    readonly sourceGenerator?: string;
    readonly targetGenerator: string;
    readonly entryPoint: (source: ComponentMetadata) => string;
    readonly recordedName?: ConnectionKind['recordedName'];
  },
): ConnectionKind => ({
  id,
  sourceGenerator: options.sourceGenerator,
  targetGenerators: [options.targetGenerator],
  recordedName: options.recordedName,
  evidence: async ({ tree, project, source, target }) => {
    const path = options.entryPoint(source);
    return (await matchGritQL(
      tree,
      joinPathFragments(project.root, path),
      // Aliased to `get<Database>` on import, so the alias names the target.
      `\`get${pascalCase(target.databaseName)}\``,
    ))
      ? path
      : undefined;
  },
});

/**
 * A connection that vends no code, recognised by the dev chain it wires from the
 * source component to the target project.
 */
const devChainConnection = (
  id: string,
  options: {
    readonly sourceGenerator?: string;
    readonly targetGenerator: string;
    /** The source project's target whose chain this connection extends. */
    readonly devTarget?: (source: ComponentMetadata) => string;
    readonly recordedName?: ConnectionKind['recordedName'];
  },
): ConnectionKind => ({
  id,
  sourceGenerator: options.sourceGenerator,
  targetGenerators: [options.targetGenerator],
  recordedName: options.recordedName,
  evidence: ({ project, source, target }) =>
    dependsOnTargetDev(project, target, options.devTarget?.(source) ?? 'dev')
      ? target.projectRoot
      : undefined,
});

/** The `<component>-dev` target a component generator authors for itself. */
const componentDevTarget = (source: ComponentMetadata) =>
  `${source.name ?? 'agent'}-dev`;

/** The tRPC-over-HTTP integration patterns, whose extra client packages differ. */
const REST_API_INFRA = new Set(['rest-lambda', 'serverlessapigatewayrestapi']);

/**
 * A website connection, recognised by the provider component it vends for its
 * target under the website's source root.
 */
const websiteConnection = (
  id: string,
  options: {
    readonly targetGenerator: string;
    readonly provider: (targetClassName: string) => string;
    readonly metadata?: ConnectionKind['metadata'];
  },
): ConnectionKind => ({
  id,
  sourceGenerator: REACT_WEBSITE_APP_GENERATOR_INFO.id,
  targetGenerators: [options.targetGenerator],
  evidence: ({ tree, project, target }) => {
    const sourceRoot =
      project.sourceRoot ?? joinPathFragments(project.root, 'src');
    const provider = joinPathFragments(
      'components',
      options.provider(target.className),
    );
    return tree.exists(joinPathFragments(sourceRoot, `${provider}.tsx`))
      ? joinPathFragments(relative(project.root, sourceRoot), provider)
      : undefined;
  },
  metadata: options.metadata,
});

/**
 * Every connection generator, and the trace each leaves on the project it connects
 * from.
 *
 * Grouped by how a run is recognised, since that follows what the generator does
 * rather than which pair it joins.
 */
export const CONNECTION_KINDS: readonly ConnectionKind[] = [
  // Agent to service: imports a Layer-2 client named after the target.
  agentClientConnection(TS_AGENT_MCP_CONNECTION_GENERATOR_INFO.id, 'ts', [
    TS_MCP_SERVER_GENERATOR_INFO.id,
    PY_MCP_SERVER_GENERATOR_INFO.id,
  ]),
  agentClientConnection(TS_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO.id, 'ts', [
    AGENTCORE_GATEWAY_GENERATOR_INFO.id,
  ]),
  agentClientConnection(TS_AGENT_A2A_CONNECTION_GENERATOR_INFO.id, 'ts', [
    TS_AGENT_GENERATOR_INFO.id,
    PY_AGENT_GENERATOR_INFO.id,
  ]),
  agentClientConnection(PY_AGENT_MCP_CONNECTION_GENERATOR_INFO.id, 'py', [
    TS_MCP_SERVER_GENERATOR_INFO.id,
    PY_MCP_SERVER_GENERATOR_INFO.id,
  ]),
  agentClientConnection(PY_AGENT_GATEWAY_CONNECTION_GENERATOR_INFO.id, 'py', [
    AGENTCORE_GATEWAY_GENERATOR_INFO.id,
  ]),
  agentClientConnection(PY_AGENT_A2A_CONNECTION_GENERATOR_INFO.id, 'py', [
    TS_AGENT_GENERATOR_INFO.id,
    PY_AGENT_GENERATOR_INFO.id,
  ]),

  // Website to backend: vends a provider component named after the target.
  websiteConnection(TRPC_REACT_GENERATOR_INFO.id, {
    targetGenerator: TRPC_BACKEND_GENERATOR_INFO.id,
    provider: (className) => `${className}ClientProvider`,
    metadata: ({ target }) => ({
      auth: String(target.project.auth ?? 'iam').toLowerCase(),
      isRestApi: REST_API_INFRA.has(
        String(
          target.project.infra ?? target.project.computeType ?? '',
        ).toLowerCase(),
      ),
    }),
  }),
  // Both OpenAPI react clients vend the same provider shape.
  websiteConnection(SMITHY_REACT_CONNECTION_GENERATOR_INFO.id, {
    targetGenerator: TS_SMITHY_API_GENERATOR_INFO.id,
    provider: (className) => `${className}Provider`,
  }),
  websiteConnection(FAST_API_REACT_GENERATOR_INFO.id, {
    targetGenerator: FAST_API_GENERATOR_INFO.id,
    provider: (className) => `${className}Provider`,
  }),
  websiteConnection(TS_AGENT_REACT_CONNECTION_GENERATOR_INFO.id, {
    targetGenerator: TS_AGENT_GENERATOR_INFO.id,
    provider: (className) => `${className}AgentClientProvider`,
  }),
  websiteConnection(PY_AGENT_REACT_CONNECTION_GENERATOR_INFO.id, {
    targetGenerator: PY_AGENT_GENERATOR_INFO.id,
    provider: (className) => `${className}AgentClientProvider`,
  }),

  // Database to component: imports the database's `get<Database>` client getter.
  rdbConnection(TS_RDB_AGENT_CONNECTION_GENERATOR_INFO.id, {
    sourceGenerator: TS_AGENT_GENERATOR_INFO.id,
    targetGenerator: TS_RDB_GENERATOR_INFO.id,
    entryPoint: (source) =>
      joinPathFragments('src', source.name ?? 'agent', 'agent.ts'),
    recordedName: sourceQualifiedName(camelDatabase, 'agent'),
  }),
  rdbConnection(TS_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO.id, {
    sourceGenerator: TS_MCP_SERVER_GENERATOR_INFO.id,
    targetGenerator: TS_RDB_GENERATOR_INFO.id,
    entryPoint: (source) =>
      joinPathFragments('src', source.name ?? 'mcp-server', 'server.ts'),
    recordedName: sourceQualifiedName(camelDatabase, 'mcp-server'),
  }),
  rdbConnection(TS_RDB_SMITHY_CONNECTION_GENERATOR_INFO.id, {
    targetGenerator: TS_RDB_GENERATOR_INFO.id,
    entryPoint: () => joinPathFragments('src', 'context.ts'),
    recordedName: camelDatabase,
  }),

  // Vends a middleware or dependency module named after the database.
  {
    id: TS_RDB_TRPC_CONNECTION_GENERATOR_INFO.id,
    targetGenerators: [TS_RDB_GENERATOR_INFO.id],
    recordedName: camelDatabase,
    evidence: ({ tree, project, target }) => {
      const path = joinPathFragments(
        'src',
        'middleware',
        `${kebabCase(target.databaseName)}.ts`,
      );
      return tree.exists(joinPathFragments(project.root, path))
        ? path
        : undefined;
    },
  },
  {
    id: PY_RDB_FAST_API_CONNECTION_GENERATOR_INFO.id,
    targetGenerators: [PY_RDB_GENERATOR_INFO.id],
    recordedName: ({ target }) => toSnakeCase(target.databaseName),
    evidence: ({ tree, project, target }) => {
      const dependencies = pythonDependenciesDir(tree, project);
      if (!dependencies) {
        return undefined;
      }
      const path = joinPathFragments(
        dependencies,
        `${toSnakeCase(target.databaseName)}.py`,
      );
      return tree.exists(joinPathFragments(project.root, path))
        ? path
        : undefined;
    },
  },

  // Python database connections vend no code into the source, so the dev chain and
  // the workspace dependency on the database project are the trace.
  devChainConnection(PY_RDB_AGENT_CONNECTION_GENERATOR_INFO.id, {
    recordedName: sourceQualifiedName(targetProjectName, 'agent'),
    sourceGenerator: PY_AGENT_GENERATOR_INFO.id,
    targetGenerator: PY_RDB_GENERATOR_INFO.id,
    devTarget: componentDevTarget,
  }),
  devChainConnection(PY_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO.id, {
    recordedName: sourceQualifiedName(targetProjectName, 'mcp-server'),
    sourceGenerator: PY_MCP_SERVER_GENERATOR_INFO.id,
    targetGenerator: PY_RDB_GENERATOR_INFO.id,
    devTarget: (source) => `${source.name ?? 'mcp-server'}-dev`,
  }),

  // DynamoDB connections grant IAM in the target's infrastructure rather than
  // vending code, so the dev chain is all they leave behind.
  devChainConnection(TS_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO.id, {
    recordedName: sourceQualifiedName(targetProjectName, 'agent'),
    sourceGenerator: TS_AGENT_GENERATOR_INFO.id,
    targetGenerator: TS_DYNAMODB_GENERATOR_INFO.id,
    devTarget: componentDevTarget,
  }),
  devChainConnection(TS_DYNAMODB_MCP_SERVER_CONNECTION_GENERATOR_INFO.id, {
    recordedName: sourceQualifiedName(targetProjectName, 'mcp-server'),
    sourceGenerator: TS_MCP_SERVER_GENERATOR_INFO.id,
    targetGenerator: TS_DYNAMODB_GENERATOR_INFO.id,
    devTarget: (source) => `${source.name ?? 'mcp-server'}-dev`,
  }),
  devChainConnection(TS_DYNAMODB_TRPC_CONNECTION_GENERATOR_INFO.id, {
    recordedName: targetProjectName,
    targetGenerator: TS_DYNAMODB_GENERATOR_INFO.id,
  }),
  devChainConnection(TS_DYNAMODB_SMITHY_CONNECTION_GENERATOR_INFO.id, {
    recordedName: targetProjectName,
    targetGenerator: TS_DYNAMODB_GENERATOR_INFO.id,
  }),
  devChainConnection(PY_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO.id, {
    recordedName: sourceQualifiedName(targetProjectName, 'agent'),
    sourceGenerator: PY_AGENT_GENERATOR_INFO.id,
    targetGenerator: PY_DYNAMODB_GENERATOR_INFO.id,
    devTarget: componentDevTarget,
  }),
  devChainConnection(PY_DYNAMODB_MCP_SERVER_CONNECTION_GENERATOR_INFO.id, {
    recordedName: sourceQualifiedName(targetProjectName, 'mcp-server'),
    sourceGenerator: PY_MCP_SERVER_GENERATOR_INFO.id,
    targetGenerator: PY_DYNAMODB_GENERATOR_INFO.id,
    devTarget: (source) => `${source.name ?? 'mcp-server'}-dev`,
  }),
  devChainConnection(PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO.id, {
    recordedName: targetProjectName,
    targetGenerator: PY_DYNAMODB_GENERATOR_INFO.id,
  }),

  // Gateway to upstream: registers the upstream in the gateway's local-dev.ts,
  // under the kebab-cased class name the deployed gateway also uses.
  ...(
    [
      [
        AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO.id,
        [TS_MCP_SERVER_GENERATOR_INFO.id, PY_MCP_SERVER_GENERATOR_INFO.id],
      ],
      [
        AGENTCORE_GATEWAY_GATEWAY_CONNECTION_GENERATOR_INFO.id,
        [AGENTCORE_GATEWAY_GENERATOR_INFO.id],
      ],
    ] as const
  ).map(([id, targetGenerators]) => ({
    id,
    sourceGenerator: AGENTCORE_GATEWAY_GENERATOR_INFO.id,
    targetGenerators,
    recordedName: ({ target }: ConnectionContext) =>
      kebabCase(target.className),
    evidence: async ({ tree, project, target }: ConnectionContext) =>
      (await matchGritQL(
        tree,
        joinPathFragments(project.root, 'local-dev.ts'),
        `\`'${kebabCase(target.className)}'\``,
      ))
        ? target.projectRoot
        : undefined,
  })),
];

/**
 * A thing in the workspace a connection could have been made to, by the names its
 * generated code is derived from.
 */
interface ConnectionTarget {
  /** The class name a client or provider for this target is named after. */
  readonly className: string;
  /**
   * The last segment of the target project's name, which the database connections
   * derive their identifiers from.
   */
  readonly databaseName: string;
  /** The target project's name, which a dev-target dependency names. */
  readonly projectName: string;
  /** The target project's root, recorded as `path` by the connections that vend no file. */
  readonly projectRoot: string;
  /** The target project's metadata, which a connection's own fields come from. */
  readonly project: ProjectMetadata;
}

/**
 * Every connection target in the workspace, keyed by the generator that created it.
 *
 * A target may be a component of a project (an agent, an MCP server) or a whole
 * project (a gateway, an API, a database), so both are indexed. Agents, MCP servers
 * and gateways record the class name directly as `rc`; an API's is derived from its
 * `apiName` the same way its connection generator derives it.
 */
const connectionTargets = (tree: Tree): Map<string, ConnectionTarget[]> => {
  const targets = new Map<string, ConnectionTarget[]>();
  for (const [projectName, project] of getProjects(tree)) {
    const metadata = project.metadata as ProjectMetadata | undefined;
    if (!metadata) {
      continue;
    }
    const shared = {
      // The database generators split on `/` for TypeScript and `.` for Python.
      databaseName: projectName.split(/[/.]/).pop() ?? projectName,
      projectName,
      projectRoot: project.root,
      project: metadata,
    };
    const add = (generator: string | undefined, className: unknown) => {
      if (!generator || typeof className !== 'string') {
        return;
      }
      targets.set(generator, [
        ...(targets.get(generator) ?? []),
        { ...shared, className },
      ]);
    };
    add(
      metadata.generator,
      metadata.rc ??
        (typeof metadata.apiName === 'string'
          ? toClassName(metadata.apiName)
          : // A database is named by its project, not a recorded class name.
            shared.databaseName),
    );
    for (const component of metadata.components ?? []) {
      add(component.generator, component.rc);
    }
  }
  return targets;
};

/**
 * The Python module a FastAPI project's sources live in, found by looking for the
 * `dependencies` directory the connections vend into.
 *
 * The module name mixes the workspace's npm scope with the API name, so it is read
 * off the tree rather than derived — a scope that has since changed would make a
 * derived name wrong.
 */
const pythonDependenciesDir = (
  tree: Tree,
  project: ProjectConfiguration,
): string | undefined =>
  tree
    .children(project.root)
    .map((child) => joinPathFragments(child, 'dependencies'))
    .find((dir) => tree.exists(joinPathFragments(project.root, dir)));

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

    // What a Smithy project models, and the namespace it declares. Neither gates a
    // dependency yet, but recording them now means a future gate reads them in a
    // workspace this backfill has already run on.
    if (next.generator === SMITHY_PROJECT_GENERATOR_INFO.id) {
      if (next.smithyType === undefined) {
        const smithyType = smithyProjectType(tree, project.root);
        if (smithyType) {
          next.smithyType = smithyType;
          changed = true;
        }
      }
      if (next.namespace === undefined) {
        const namespace = smithyNamespace(tree, project);
        if (namespace) {
          next.namespace = namespace;
          changed = true;
        }
      }
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
    //
    // Left absent rather than set to an empty list where the project has no
    // components, so a project this backfill has nothing to add to is untouched.
    next.components = next.components?.map((component) => {
      if (component.iac !== undefined) {
        return component;
      }
      const componentIac =
        // The auth component vends no infrastructure of its own; it always
        // generates the shared constructs, so it took the project's provider.
        component.generator === COGNITO_AUTH_GENERATOR_INFO.id
          ? iac
          : componentInfrastructureProvider(tree, component);
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
    // The connections made from this project, each found by the trace its
    // generator left for the exact pair it wired up.
    for (const kind of CONNECTION_KINDS) {
      // A connection made from a component starts at each matching component. One
      // made from the project as a whole — a website, a tRPC API — starts at the
      // project's own metadata, which stands in for the source.
      const componentSources = (next.components ?? []).filter(
        (component) => component.generator === kind.sourceGenerator,
      );
      const sources: ComponentMetadata[] = componentSources.length
        ? componentSources
        : (kind.sourceGenerator === undefined ||
              kind.sourceGenerator === next.generator) &&
            next.generator
          ? [{ ...next, generator: next.generator }]
          : [];
      const candidates = kind.targetGenerators.flatMap(
        (generator) => targets.get(generator) ?? [],
      );
      for (const source of sources) {
        for (const target of candidates) {
          // A connection from a component to itself is not one any generator makes.
          if (
            target.projectName === projectName &&
            target.className === source.rc
          ) {
            continue;
          }
          const context: ConnectionContext = { tree, project, source, target };
          const name = kind.recordedName?.(context) ?? target.className;
          if (recorded.has(`${kind.id}:${name}`)) {
            continue;
          }
          const path = await kind.evidence(context);
          if (path === undefined) {
            continue;
          }
          record({
            generator: kind.id,
            path,
            name,
            ...(kind.sourceGenerator && source.path
              ? { sourcePath: source.path }
              : {}),
            ...kind.metadata?.(context),
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
