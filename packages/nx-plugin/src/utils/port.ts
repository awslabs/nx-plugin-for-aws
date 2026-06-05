/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, type ProjectConfiguration, type Tree } from '@nx/devkit';

/**
 * Assign a port shared across all projects created by the same generator.
 * If a sibling project already has a port assigned, reuse it; otherwise assign a fresh one.
 * Mutates the project to register the port in its metadata.ports.
 */
export const assignSharedPort = (
  tree: Tree,
  project: ProjectConfiguration,
  generatorId: string,
  startPort: number,
): number => {
  const existingPort = [...getProjects(tree).values()].find(
    (p) => (p.metadata as any)?.generator === generatorId,
  )?.metadata as any;

  if (existingPort?.ports?.[0] !== undefined) {
    const port = existingPort.ports[0] as number;
    project.metadata ??= {};
    (project.metadata as any).ports = [
      ...((project.metadata as any).ports ?? []),
      port,
    ];
    return port;
  }

  return assignPort(tree, project, startPort);
};

/**
 * Assign a port for a particular target within a project.
 * Mutates the project to add/update its metadata.ports with the newly assigned port
 */
export const assignPort = (
  tree: Tree,
  project: ProjectConfiguration,
  startPort: number,
) => {
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
