/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, ProjectConfiguration, Tree } from '@nx/devkit';

/**
 * Assign a port for a particular target within a project.
 * Mutates the project to add/update its metadata.ports with the newly assigned port
 */
export const assignPort = (tree: Tree, project: ProjectConfiguration, startPort: number) => {
  // Find all existing ports
  const allPorts = new Set([...getProjects(tree).values()].flatMap((p) => {
    const metadata = p.metadata as any;
    const ports: number[] = [];
    // Support old port assignment where each project registered a single port
    if (metadata?.port && typeof metadata.port === 'number') {
      ports.push(metadata.port);
    }
    if (metadata?.ports && typeof metadata.ports === 'object' && Array.isArray(metadata.ports)) {
      ports.push(...metadata.ports);
    }
    return ports;
  }));

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
