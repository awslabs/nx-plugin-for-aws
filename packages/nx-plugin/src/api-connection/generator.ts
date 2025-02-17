/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  ProjectConfiguration,
  readProjectConfiguration,
  Tree,
} from '@nx/devkit';
import { ApiConnectionSchema } from './schema';
import trpcReactGenerator from '../trpc/react/generator';
import { hasExportDeclaration } from '../utils/ast';

/**
 * List of supported source and target project types for api connections
 */
const SUPPORTED_PROJECT_TYPES = ['trpc#api', 'react'] as const;

type ProjectType = (typeof SUPPORTED_PROJECT_TYPES)[number];

type Connection = { source: ProjectType; target: ProjectType };

/**
 * Enumerates the supported project connections
 */
const SUPPORTED_CONNECTIONS = [
  { source: 'react', target: 'trpc#api' },
] satisfies Connection[];

type ConnectionKey = (typeof SUPPORTED_CONNECTIONS)[number] extends infer C
  ? C extends Connection
    ? `${C['source']} -> ${C['target']}`
    : never
  : never;

/**
 * Generators for each connection type
 */
const CONNECTION_GENERATORS = {
  'react -> trpc#api': (tree, options) =>
    trpcReactGenerator(tree, {
      frontendProjectName: options.sourceProject,
      backendProjectName: options.targetProject,
      auth: options.auth,
    }),
} satisfies Record<
  ConnectionKey,
  (tree: Tree, options: ApiConnectionSchema) => Promise<any>
>;

/**
 * Generator for a connection from a project to an API project
 */
export const apiConnectionGenerator = async (
  tree: Tree,
  options: ApiConnectionSchema,
) => {
  const sourceType = determineProjectType(tree, options.sourceProject);
  const targetType = determineProjectType(tree, options.targetProject);

  if (!sourceType || !SUPPORTED_PROJECT_TYPES.includes(sourceType)) {
    throw new Error(
      `This generator does not support selected source project ${options.sourceProject}`,
    );
  }
  if (!targetType || !SUPPORTED_PROJECT_TYPES.includes(targetType)) {
    throw new Error(
      `This generator does not support selected target project ${options.targetProject}`,
    );
  }

  const connection = SUPPORTED_CONNECTIONS.find(
    (c) => c.source === sourceType && c.target === targetType,
  );

  if (!connection) {
    throw new Error(
      `This generator does not support a connection from ${options.sourceProject} (${sourceType}) to ${options.targetProject} (${targetType})`,
    );
  }

  return await CONNECTION_GENERATORS[
    `${connection.source} -> ${connection.target}`
  ](tree, options);
};

/**
 * Determine whether the given project is of a known project type
 */
export const determineProjectType = (
  tree: Tree,
  projectName: string,
): ProjectType | undefined => {
  const projectConfiguration = readProjectConfiguration(tree, projectName);

  // NB: if adding new checks, ensure these go from most to least specific
  // eg. react website is more specific than typescript project

  if (isTrpcApi(tree, projectConfiguration)) {
    return 'trpc#api';
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

export default apiConnectionGenerator;
