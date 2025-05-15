/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createProjectGraphAsync, ProjectGraph } from '@nx/devkit';
import { TestProject } from 'vitest/node';

/**
 * Create the project graph as a one-time operation, and provide it to setup-files.ts
 * which then mocks calls to the daemon for the graph.
 * This means we don't bombard the daemon with as many requests and reduces the chance
 * of it locking up.
 * The graph shouldn't change during tests as we're working with the Tree most of the
 * time.
 */
export default async (project: TestProject) => {
  project.provide('nxGraph', await createProjectGraphAsync());
};

declare module 'vitest' {
  export interface ProvidedContext {
    nxGraph: ProjectGraph;
  }
}
