/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, Tree, joinPathFragments } from '@nx/devkit';
import { GitlabGeneratorSchema } from './schema';

export async function gitlabGenerator(
  tree: Tree,
  options: GitlabGeneratorSchema
) {
  generateFiles(tree, joinPathFragments(__dirname, 'files'), '.', options);
}

export default gitlabGenerator;
