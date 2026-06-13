/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, type ProjectConfiguration, type Tree } from '@nx/devkit';

/**
 * Return the first port already registered in a project's own metadata, if any.
 * Supports both the metadata.ports array and the legacy metadata.port.
 */
const getExistingProjectPort = (
  project: ProjectConfiguration,
): number | undefined => {
  const metadata = project.metadata as any;
  if (Array.isArray(metadata?.ports) && typeof metadata.ports[0] === 'number') {
    return metadata.ports[0];
  }
  if (typeof metadata?.port === 'number') {
    return metadata.port;
  }
  return undefined;
};

/**
 * Return the port previously assigned to a particular component within a
 * project, if any. Projects which host multiple components (e.g. one agent or
 * MCP server per component) record a port per component in metadata.components.
 */
const getExistingComponentPort = (
  project: ProjectConfiguration,
  component: { info: { id: string }; name?: string },
): number | undefined => {
  const components = (project.metadata as any)?.components ?? [];
  const match = components.find(
    (c: any) => c.generator === component.info.id && c.name === component.name,
  );
  return typeof match?.port === 'number' ? match.port : undefined;
};

/**
 * Options for assigning a port to a target within a project.
 */
export interface AssignPortOptions {
  /**
   * Identifies the component the port is being assigned for. When provided, a
   * port already assigned to this component is reused so re-runs are
   * idempotent. Use this for projects which host a port per component.
   */
  component?: { info: { id: string }; name?: string };
}

/**
 * Assign a port shared across all projects created by the same generator (or
 * family of generators). If this project already has a port, or a sibling
 * project created by any of the given generator IDs has one, reuse it;
 * otherwise assign a fresh one. Mutates the project to register the port in
 * its metadata.ports.
 */
export const assignSharedPort = (
  tree: Tree,
  project: ProjectConfiguration,
  generatorId: string | string[],
  startPort: number,
): number => {
  const generatorIds = Array.isArray(generatorId) ? generatorId : [generatorId];

  // Reuse this project's own port if it already has one (idempotent on re-run)
  const ownPort = getExistingProjectPort(project);
  if (ownPort !== undefined) {
    return ownPort;
  }

  // Otherwise reuse a sibling project's shared port if one exists
  const siblingPort = [...getProjects(tree).values()]
    .filter((p) => p.name !== project.name)
    .map((p) => ({
      generator: (p.metadata as any)?.generator,
      port: getExistingProjectPort(p),
    }))
    .find(
      (p) => generatorIds.includes(p.generator) && p.port !== undefined,
    )?.port;

  if (siblingPort !== undefined) {
    project.metadata ??= {};
    (project.metadata as any).ports = [
      ...((project.metadata as any).ports ?? []),
      siblingPort,
    ];
    return siblingPort;
  }

  return assignPort(tree, project, startPort);
};

/**
 * Assign a port for a particular target within a project.
 * Mutates the project to add/update its metadata.ports with the newly assigned port.
 *
 * Re-runs are idempotent: a port previously assigned to this project (or, when
 * `options.component` is provided, to this component) is returned as-is without
 * registering a duplicate.
 */
export const assignPort = (
  tree: Tree,
  project: ProjectConfiguration,
  startPort: number,
  options?: AssignPortOptions,
) => {
  // Reuse a port already assigned to this project/component on re-run
  const existingPort = options?.component
    ? getExistingComponentPort(project, options.component)
    : getExistingProjectPort(project);
  if (existingPort !== undefined) {
    return existingPort;
  }

  // Find all existing ports
  const allPorts = new Set(
    [...getProjects(tree).values()].flatMap((p) => {
      const metadata = p.metadata as any;
      const ports: number[] = [];
      // Support old port assignment where each project registered a single port
      if (metadata?.port && typeof metadata.port === 'number') {
        ports.push(metadata.port);
      }
      if (
        metadata?.ports &&
        typeof metadata.ports === 'object' &&
        Array.isArray(metadata.ports)
      ) {
        ports.push(...metadata.ports);
      }
      return ports;
    }),
  );

  // Find the next available port higher than the start port
  let candidatePort = startPort;
  while (allPorts.has(candidatePort)) {
    candidatePort++;
  }

  project.metadata ??= {};
  (project.metadata as any).ports ??= [];
  (project.metadata as any).ports = [
    ...(project.metadata as any).ports,
    candidatePort,
  ];

  return candidatePort;
};
