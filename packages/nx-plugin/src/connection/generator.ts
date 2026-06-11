/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../agentcore-gateway/generator';
import agentcoreGatewayMcpConnectionGenerator from '../agentcore-gateway/mcp-connection/generator';
import pyAgentA2aConnectionGenerator from '../py/agent/a2a-connection/generator';
import pyAgentGatewayConnectionGenerator from '../py/agent/gateway-connection/generator';
import pyAgentMcpConnectionGenerator from '../py/agent/mcp-connection/generator';
import pyAgentReactConnectionGenerator from '../py/agent/react-connection/generator';
import fastApiReactGenerator from '../py/fast-api/react/generator';
import { SMITHY_PROJECT_GENERATOR_INFO } from '../smithy/project/generator';
import smithyReactConnectionGenerator from '../smithy/react-connection/generator';
import { TS_SMITHY_API_GENERATOR_INFO } from '../smithy/ts/api/generator';
import trpcReactGenerator from '../trpc/react/generator';
import tsAgentA2aConnectionGenerator from '../ts/agent/a2a-connection/generator';
import tsAgentGatewayConnectionGenerator from '../ts/agent/gateway-connection/generator';
import tsAgentMcpConnectionGenerator from '../ts/agent/mcp-connection/generator';
import tsAgentReactConnectionGenerator from '../ts/agent/react-connection/generator';
import tsDynamoDBAgentConnectionGenerator from '../ts/dynamodb/agent-connection/generator';
import { TS_DYNAMODB_GENERATOR_INFO } from '../ts/dynamodb/generator';
import tsDynamoDBMcpServerConnectionGenerator from '../ts/dynamodb/mcp-server-connection/generator';
import tsDynamoDBSmithyConnectionGenerator from '../ts/dynamodb/smithy-connection/generator';
import tsDynamoDBTrpcConnectionGenerator from '../ts/dynamodb/trpc-connection/generator';
import tsRdbAgentConnectionGenerator from '../ts/rdb/agent-connection/generator';
import { TS_RDB_GENERATOR_INFO } from '../ts/rdb/generator';
import tsRdbMcpServerConnectionGenerator from '../ts/rdb/mcp-server-connection/generator';
import tsRdbSmithyConnectionGenerator from '../ts/rdb/smithy-connection/generator';
import tsRdbTrpcConnectionGenerator from '../ts/rdb/trpc-connection/generator';
import { hasExportDeclaration } from '../utils/ast';
import {
  type ComponentMetadata,
  readProjectConfigurationUnqualified,
} from '../utils/nx';
import { readToml } from '../utils/toml';
import type { ConnectionGeneratorSchema } from './schema';

/**
 * List of supported source and target project types for connections.
 * These can be project-level types (determined by introspection) or
 * component generator ids (from component metadata).
 */
const SUPPORTED_PROJECT_TYPES = [
  'ts#trpc-api',
  'py#fast-api',
  'react',
  'smithy',
  'ts#rdb',
  'ts#dynamodb',
  'agentcore-gateway',
] as const;

type ProjectType = (typeof SUPPORTED_PROJECT_TYPES)[number];

export type Connection = { source: string; target: string };

/**
 * Sentinel value for sourceComponent/targetComponent that means
 * "use the project-level connection, not a component".
 */
export const PROJECT_COMPONENT_SENTINEL = '.';

/**
 * The result of resolving a connection, including the matched connection
 * and any resolved source/target component metadata.
 */
export interface ResolvedConnection {
  readonly connection: Connection;
  readonly sourceComponent?: ComponentMetadata;
  readonly targetComponent?: ComponentMetadata;
}

/**
 * Enumerates the supported project connections.
 * Source and target can be project-level types or component generator ids.
 */
const SUPPORTED_CONNECTIONS = [
  { source: 'ts#trpc-api', target: 'ts#rdb' },
  { source: 'ts#trpc-api', target: 'ts#dynamodb' },
  { source: 'ts#agent', target: 'ts#rdb' },
  { source: 'smithy', target: 'ts#rdb' },
  { source: 'smithy', target: 'ts#dynamodb' },
  { source: 'ts#mcp-server', target: 'ts#rdb' },
  { source: 'ts#mcp-server', target: 'ts#dynamodb' },
  { source: 'react', target: 'ts#trpc-api' },
  { source: 'react', target: 'py#fast-api' },
  { source: 'react', target: 'smithy' },
  { source: 'react', target: 'ts#agent' },
  { source: 'react', target: 'py#agent' },
  { source: 'ts#agent', target: 'ts#mcp-server' },
  { source: 'ts#agent', target: 'py#mcp-server' },
  { source: 'ts#agent', target: 'ts#dynamodb' },
  { source: 'py#agent', target: 'ts#mcp-server' },
  { source: 'py#agent', target: 'py#mcp-server' },
  { source: 'ts#agent', target: 'ts#agent' },
  { source: 'ts#agent', target: 'py#agent' },
  { source: 'py#agent', target: 'ts#agent' },
  { source: 'py#agent', target: 'py#agent' },
  { source: 'ts#agent', target: 'agentcore-gateway' },
  { source: 'py#agent', target: 'agentcore-gateway' },
  { source: 'agentcore-gateway', target: 'ts#mcp-server' },
  { source: 'agentcore-gateway', target: 'py#mcp-server' },
] as const satisfies readonly Connection[];

type ConnectionKey = (typeof SUPPORTED_CONNECTIONS)[number] extends infer C
  ? C extends Connection
    ? `${C['source']} -> ${C['target']}`
    : never
  : never;

/**
 * Generators for each connection type
 */
/**
 * Options passed to connection generators, including resolved component metadata.
 */
export interface ResolvedConnectionOptions {
  sourceProject: string;
  targetProject: string;
  sourceComponent?: ComponentMetadata;
  targetComponent?: ComponentMetadata;
}

const CONNECTION_GENERATORS = {
  'ts#trpc-api -> ts#rdb': (tree, options) =>
    tsRdbTrpcConnectionGenerator(tree, options),
  'ts#agent -> ts#rdb': (tree, options) =>
    tsRdbAgentConnectionGenerator(tree, options),
  'smithy -> ts#rdb': (tree, options) =>
    tsRdbSmithyConnectionGenerator(tree, options),
  'ts#mcp-server -> ts#rdb': (tree, options) =>
    tsRdbMcpServerConnectionGenerator(tree, options),
  'ts#trpc-api -> ts#dynamodb': (tree, options) =>
    tsDynamoDBTrpcConnectionGenerator(tree, options),
  'ts#agent -> ts#dynamodb': (tree, options) =>
    tsDynamoDBAgentConnectionGenerator(tree, options),
  'smithy -> ts#dynamodb': (tree, options) =>
    tsDynamoDBSmithyConnectionGenerator(tree, options),
  'ts#mcp-server -> ts#dynamodb': (tree, options) =>
    tsDynamoDBMcpServerConnectionGenerator(tree, options),
  'react -> ts#trpc-api': (tree, options) =>
    trpcReactGenerator(tree, {
      frontendProjectName: options.sourceProject,
      backendProjectName: options.targetProject,
    }),
  'react -> py#fast-api': (tree, options) =>
    fastApiReactGenerator(tree, {
      frontendProjectName: options.sourceProject,
      fastApiProjectName: options.targetProject,
    }),
  'react -> smithy': (tree, options) =>
    smithyReactConnectionGenerator(tree, {
      frontendProjectName: options.sourceProject,
      smithyModelOrBackendProjectName: options.targetProject,
    }),
  'react -> ts#agent': (tree, options) =>
    tsAgentReactConnectionGenerator(tree, options),
  'react -> py#agent': (tree, options) =>
    pyAgentReactConnectionGenerator(tree, options),
  'ts#agent -> ts#mcp-server': (tree, options) =>
    tsAgentMcpConnectionGenerator(tree, options),
  'ts#agent -> py#mcp-server': (tree, options) =>
    tsAgentMcpConnectionGenerator(tree, options),
  'py#agent -> ts#mcp-server': (tree, options) =>
    pyAgentMcpConnectionGenerator(tree, options),
  'py#agent -> py#mcp-server': (tree, options) =>
    pyAgentMcpConnectionGenerator(tree, options),
  'ts#agent -> ts#agent': (tree, options) =>
    tsAgentA2aConnectionGenerator(tree, options),
  'ts#agent -> py#agent': (tree, options) =>
    tsAgentA2aConnectionGenerator(tree, options),
  'py#agent -> ts#agent': (tree, options) =>
    pyAgentA2aConnectionGenerator(tree, options),
  'py#agent -> py#agent': (tree, options) =>
    pyAgentA2aConnectionGenerator(tree, options),
  'ts#agent -> agentcore-gateway': (tree, options) =>
    tsAgentGatewayConnectionGenerator(tree, options),
  'py#agent -> agentcore-gateway': (tree, options) =>
    pyAgentGatewayConnectionGenerator(tree, options),
  'agentcore-gateway -> ts#mcp-server': (tree, options) =>
    agentcoreGatewayMcpConnectionGenerator(tree, options),
  'agentcore-gateway -> py#mcp-server': (tree, options) =>
    agentcoreGatewayMcpConnectionGenerator(tree, options),
} satisfies Record<
  ConnectionKey,
  (tree: Tree, options: ResolvedConnectionOptions) => Promise<any>
>;

/**
 * Generator for a connection between two projects
 */
export const connectionGenerator = async (
  tree: Tree,
  options: ConnectionGeneratorSchema,
) => {
  const resolved = await resolveConnection(tree, options);

  const connectionKey =
    `${resolved.connection.source} -> ${resolved.connection.target}` as ConnectionKey;

  return await CONNECTION_GENERATORS[connectionKey](tree, {
    sourceProject: options.sourceProject,
    targetProject: options.targetProject,
    sourceComponent: resolved.sourceComponent,
    targetComponent: resolved.targetComponent,
  });
};

/**
 * Find a component in project metadata matching the given reference.
 * Checks by name first, then by path, then by generator.
 */
export const findComponentInMetadata = (
  projectConfiguration: ProjectConfiguration,
  componentRef: string,
): ComponentMetadata | undefined => {
  const components: ComponentMetadata[] =
    (projectConfiguration.metadata as any)?.components ?? [];

  return (
    components.find((c) => c.name === componentRef) ??
    components.find((c) => c.path === componentRef) ??
    components.find((c) => c.generator === componentRef)
  );
};

/**
 * Represents a candidate source or target for a connection, which may be
 * the project itself or a specific component within the project.
 */
interface ConnectionCandidate {
  readonly type: string;
  readonly component?: ComponentMetadata;
}

/**
 * A matched connection between source and target candidates.
 */
interface ConnectionMatch {
  readonly connection: Connection;
  readonly sourceComponent?: ComponentMetadata;
  readonly targetComponent?: ComponentMetadata;
}

/**
 * Gather all connection candidates for a project configuration. This includes:
 * - The project-level type (if it's a supported type)
 * - Each component's generator id as a candidate type
 */
const gatherCandidates = async (
  tree: Tree,
  projectConfig: ProjectConfiguration,
): Promise<ConnectionCandidate[]> => {
  const type = await determineProjectTypeFromConfig(tree, projectConfig);
  const components: ComponentMetadata[] =
    (projectConfig.metadata as any)?.components ?? [];

  return [
    ...(type ? [{ type: type }] : []),
    ...components.map((component) => ({
      type: component.generator,
      component,
    })),
  ];
};

/**
 * Validate that a specified component exists in the project metadata.
 * Skips validation for undefined refs and the project sentinel '.'.
 */
const validateComponent = (
  componentRef: string | undefined,
  projectConfig: ProjectConfiguration,
  side: 'source' | 'target',
) => {
  if (!componentRef || componentRef === PROJECT_COMPONENT_SENTINEL) return;
  const found = findComponentInMetadata(projectConfig, componentRef);
  if (!found) {
    const components: ComponentMetadata[] =
      (projectConfig.metadata as any)?.components ?? [];
    throw new Error(
      `Component '${componentRef}' not found in ${side} project ${projectConfig.name}. ` +
        `Available components: ${components.length > 0 ? components.map((c) => c.name ?? c.generator).join(', ') : 'none'}`,
    );
  }
};

/**
 * Narrow candidates based on the user's specified component reference.
 */
const filterConnectionCandidatesForComponentReference = (
  componentRef: string | undefined,
  projectConfig: ProjectConfiguration,
  candidates: ConnectionCandidate[],
  supportedConnections: readonly Connection[],
  side: 'source' | 'target',
): ConnectionCandidate[] => {
  if (!componentRef) return candidates;
  if (componentRef === PROJECT_COMPONENT_SENTINEL) {
    return candidates.filter((c) => !c.component);
  }
  const component = findComponentInMetadata(projectConfig, componentRef);
  if (!component) return candidates;
  const isConnectionParticipant = supportedConnections.some(
    (c) => c[side] === component.generator,
  );
  if (!isConnectionParticipant) return candidates;
  // Filter to the specific matched component, not all components with the same generator
  return candidates.filter((c) => c.component === component);
};

/**
 * Resolve the connection to use, considering source/target projects and components.
 */
export const resolveConnection = async (
  tree: Tree,
  options: ConnectionGeneratorSchema,
  supportedConnections: readonly Connection[] = SUPPORTED_CONNECTIONS,
): Promise<ResolvedConnection> => {
  const sourceConfig = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetConfig = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  // Validate explicitly specified components exist
  validateComponent(options.sourceComponent, sourceConfig, 'source');
  validateComponent(options.targetComponent, targetConfig, 'target');

  // Gather and narrow candidates
  const sourceCandidates = filterConnectionCandidatesForComponentReference(
    options.sourceComponent,
    sourceConfig,
    await gatherCandidates(tree, sourceConfig),
    supportedConnections,
    'source',
  );
  const targetCandidates = filterConnectionCandidatesForComponentReference(
    options.targetComponent,
    targetConfig,
    await gatherCandidates(tree, targetConfig),
    supportedConnections,
    'target',
  );

  // Cross-product candidates and find supported connections
  const matches: ConnectionMatch[] = [];
  for (const source of sourceCandidates) {
    for (const target of targetCandidates) {
      const match = supportedConnections.find(
        (c) => c.source === source.type && c.target === target.type,
      );
      if (match) {
        matches.push({
          connection: match,
          sourceComponent: source.component,
          targetComponent: target.component,
        });
      }
    }
  }

  if (matches.length === 0) {
    const sourceTypes = [...new Set(sourceCandidates.map((c) => c.type))];
    const targetTypes = [...new Set(targetCandidates.map((c) => c.type))];
    throw new Error(
      `This generator does not support a connection from ${options.sourceProject}${sourceTypes.length > 0 ? ` (${sourceTypes.join(', ')})` : ''} to ${options.targetProject}${targetTypes.length > 0 ? ` (${targetTypes.join(', ')})` : ''}`,
    );
  }

  if (matches.length > 1) {
    const connectionDescriptions = matches
      .map((m) => {
        const sourceName = m.sourceComponent?.name;
        const targetName = m.targetComponent?.name;
        const sourceLabel = sourceName
          ? `${sourceName} (${m.connection.source})`
          : m.connection.source;
        const targetLabel = targetName
          ? `${targetName} (${m.connection.target})`
          : m.connection.target;
        return `${sourceLabel} -> ${targetLabel}`;
      })
      .join(', ');
    throw new Error(
      `Ambiguous connection from ${options.sourceProject} to ${options.targetProject}. ` +
        `Multiple supported connections found: ${connectionDescriptions}. ` +
        `Please specify sourceComponent and/or targetComponent to disambiguate.`,
    );
  }

  return {
    connection: matches[0].connection,
    sourceComponent: matches[0].sourceComponent,
    targetComponent: matches[0].targetComponent,
  };
};

/**
 * Determine whether the given project is of a known project type
 */
export const determineProjectType = async (
  tree: Tree,
  projectName: string,
): Promise<ProjectType | undefined> => {
  const projectConfiguration = readProjectConfigurationUnqualified(
    tree,
    projectName,
  );
  return await determineProjectTypeFromConfig(tree, projectConfiguration);
};

/**
 * Determine whether the given project configuration is of a known project type
 */
const determineProjectTypeFromConfig = async (
  tree: Tree,
  projectConfiguration: ProjectConfiguration,
): Promise<ProjectType | undefined> => {
  // NB: if adding new checks, ensure these go from most to least specific
  // eg. react website is more specific than typescript project

  if (await isTrpcApi(tree, projectConfiguration)) {
    return 'ts#trpc-api';
  }

  if (isFastApi(tree, projectConfiguration)) {
    return 'py#fast-api';
  }

  if (isSmithyApi(tree, projectConfiguration)) {
    return 'smithy';
  }

  if (isReact(tree, projectConfiguration)) {
    return 'react';
  }

  if (isRdb(projectConfiguration)) {
    return 'ts#rdb';
  }

  if (isDynamoDB(projectConfiguration)) {
    return 'ts#dynamodb';
  }

  if (isAgentCoreGateway(projectConfiguration)) {
    return 'agentcore-gateway';
  }

  return undefined;
};

const sourceRoot = (projectConfiguration: ProjectConfiguration) =>
  projectConfiguration.sourceRoot ??
  joinPathFragments(projectConfiguration.root, 'src');

const isTrpcApi = async (
  tree: Tree,
  projectConfiguration: ProjectConfiguration,
): Promise<boolean> => {
  // If the project.json says it's a trpc api, there's no need for introspection
  if ((projectConfiguration.metadata as any)?.apiType === 'trpc') {
    return true;
  }

  // Find the src/index.ts
  const indexTs = tree.read(
    joinPathFragments(sourceRoot(projectConfiguration), 'index.ts'),
    'utf-8',
  );
  if (indexTs === null) {
    return false;
  }

  // If the index file exports an AppRouter, it's a trpc api
  if (await hasExportDeclaration(tree, indexTs, 'AppRouter')) {
    return true;
  }

  // If there's a src/router.ts or src/lambdas/router.ts which exports an AppRouter, it's a trpc api
  const trpcRouter =
    tree.read(
      joinPathFragments(sourceRoot(projectConfiguration), 'router.ts'),
      'utf-8',
    ) ??
    tree.read(
      joinPathFragments(
        sourceRoot(projectConfiguration),
        'lambdas',
        'router.ts',
      ),
      'utf-8',
    );

  if (trpcRouter === null) {
    return false;
  }

  if (await hasExportDeclaration(tree, trpcRouter, 'AppRouter')) {
    return true;
  }

  return false;
};

const isReact = (
  tree: Tree,
  projectConfiguration: ProjectConfiguration,
): boolean => {
  // if there's a main.tsx, it's a react app
  return tree.exists(
    joinPathFragments(sourceRoot(projectConfiguration), 'main.tsx'),
  );
};

const isFastApi = (
  tree: Tree,
  projectConfiguration: ProjectConfiguration,
): boolean => {
  // If the project.json says it's a fast api, there's no need for introspection
  if ((projectConfiguration.metadata as any)?.apiType === 'fast-api') {
    return true;
  }

  const pyProjectPath = joinPathFragments(
    projectConfiguration.root,
    'pyproject.toml',
  );
  if (tree.exists(pyProjectPath)) {
    const pyProject = readToml(tree, pyProjectPath);
    if (((pyProject as any)?.project?.dependencies ?? []).includes('fastapi')) {
      return true;
    }
  }

  return false;
};

const isSmithyApi = (
  _tree: Tree,
  projectConfiguration: ProjectConfiguration,
): boolean => {
  // Support selecting either the smithy model or backend project
  return [
    SMITHY_PROJECT_GENERATOR_INFO.id,
    TS_SMITHY_API_GENERATOR_INFO.id,
  ].includes(((projectConfiguration.metadata as any) ?? {}).generator);
};

const isRdb = (projectConfiguration: ProjectConfiguration): boolean =>
  ((projectConfiguration.metadata as any) ?? {}).generator ===
  TS_RDB_GENERATOR_INFO.id;

const isDynamoDB = (projectConfiguration: ProjectConfiguration): boolean =>
  ((projectConfiguration.metadata as any) ?? {}).generator ===
  TS_DYNAMODB_GENERATOR_INFO.id;

const isAgentCoreGateway = (
  projectConfiguration: ProjectConfiguration,
): boolean =>
  ((projectConfiguration.metadata as any) ?? {}).generator ===
  AGENTCORE_GATEWAY_GENERATOR_INFO.id;

export default connectionGenerator;
