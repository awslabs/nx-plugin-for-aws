/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, ProjectConfiguration, Tree } from '@nx/devkit';
import { ConnectionGeneratorSchema } from './schema';
import trpcReactGenerator from '../trpc/react/generator';
import { hasExportDeclaration } from '../utils/ast';
import { readToml } from '../utils/toml';
import fastApiReactGenerator from '../py/fast-api/react/generator';
import {
  ComponentMetadata,
  readProjectConfigurationUnqualified,
} from '../utils/nx';
import { SMITHY_PROJECT_GENERATOR_INFO } from '../smithy/project/generator';
import { TS_SMITHY_API_GENERATOR_INFO } from '../smithy/ts/api/generator';
import smithyReactConnectionGenerator from '../smithy/react-connection/generator';

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
  { source: 'react', target: 'ts#trpc-api' },
  { source: 'react', target: 'py#fast-api' },
  { source: 'react', target: 'smithy' },
] as const satisfies readonly Connection[];

type ConnectionKey = (typeof SUPPORTED_CONNECTIONS)[number] extends infer C
  ? C extends Connection
    ? `${C['source']} -> ${C['target']}`
    : never
  : never;

/**
 * Generators for each connection type
 */
const CONNECTION_GENERATORS = {
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
} satisfies Record<
  ConnectionKey,
  (tree: Tree, options: ConnectionGeneratorSchema) => Promise<any>
>;

/**
 * Generator for a connection between two projects
 */
export const connectionGenerator = async (
  tree: Tree,
  options: ConnectionGeneratorSchema,
) => {
  const { connection } = resolveConnection(tree, options);

  const connectionKey =
    `${connection.source} -> ${connection.target}` as ConnectionKey;

  return await CONNECTION_GENERATORS[connectionKey](tree, options);
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
const gatherCandidates = (
  tree: Tree,
  projectConfig: ProjectConfiguration,
): ConnectionCandidate[] => {
  const projectType = determineProjectTypeFromConfig(tree, projectConfig);
  const components: ComponentMetadata[] =
    (projectConfig.metadata as any)?.components ?? [];

  return [
    ...(projectType ? [{ type: projectType }] : []),
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
  return candidates.filter(
    (c) => c.component?.generator === component.generator,
  );
};

/**
 * Resolve the connection to use, considering source/target projects and components.
 */
export const resolveConnection = (
  tree: Tree,
  options: ConnectionGeneratorSchema,
  supportedConnections: readonly Connection[] = SUPPORTED_CONNECTIONS,
): ResolvedConnection => {
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
    gatherCandidates(tree, sourceConfig),
    supportedConnections,
    'source',
  );
  const targetCandidates = filterConnectionCandidatesForComponentReference(
    options.targetComponent,
    targetConfig,
    gatherCandidates(tree, targetConfig),
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
      .map((m) => `${m.connection.source} -> ${m.connection.target}`)
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
export const determineProjectType = (
  tree: Tree,
  projectName: string,
): ProjectType | undefined => {
  const projectConfiguration = readProjectConfigurationUnqualified(
    tree,
    projectName,
  );
  return determineProjectTypeFromConfig(tree, projectConfiguration);
};

/**
 * Determine whether the given project configuration is of a known project type
 */
const determineProjectTypeFromConfig = (
  tree: Tree,
  projectConfiguration: ProjectConfiguration,
): ProjectType | undefined => {
  // NB: if adding new checks, ensure these go from most to least specific
  // eg. react website is more specific than typescript project

  if (isTrpcApi(tree, projectConfiguration)) {
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

  return undefined;
};

const sourceRoot = (projectConfiguration: ProjectConfiguration) =>
  projectConfiguration.sourceRoot ??
  joinPathFragments(projectConfiguration.root, 'src');

const isTrpcApi = (
  tree: Tree,
  projectConfiguration: ProjectConfiguration,
): boolean => {
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
  if (hasExportDeclaration(indexTs, 'AppRouter')) {
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

  if (hasExportDeclaration(trpcRouter, 'AppRouter')) {
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

export default connectionGenerator;
