/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, Tree } from '@nx/devkit';
import { NxGeneratorInfo } from './nx';

/**
 * Get a unique port number for a local server created by the given generator.
 * To be counted, projects must have 'port' in metadata.
 * Assumes startPort is sufficiently spaced from other generators!
 */
export const getLocalServerPortNumber = (
  tree: Tree,
  generatorInfo: NxGeneratorInfo,
  startPort: number,
) => {
  const existingProjectCount = [...getProjects(tree).values()].filter(
    (p) =>
      (p.metadata as any)?.generator === generatorInfo.id &&
      (p.metadata as any)?.port,
  ).length;
  return startPort + existingProjectCount;
};
