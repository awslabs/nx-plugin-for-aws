/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, joinPathFragments, Tree, updateJson } from '@nx/devkit';
import { LicenseConfig } from '../config-types';
import { updateToml } from '../../utils/toml';

/**
 * Different project files with licensing information to be synchronised
 */
export const PROJECT_FILES_TO_SYNC = [
  'LICENSE',
  'package.json',
  'pyproject.toml',
] as const;

export type ProjectFileToSync = (typeof PROJECT_FILES_TO_SYNC)[number];

/**
 * Methods to sync each type of project file
 */
const SYNC_STRATEGIES: Record<
  ProjectFileToSync,
  (tree: Tree, projectRoot: string, config: LicenseConfig) => void
> = {
  LICENSE: (tree, projectRoot, config) => {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'licenses', config.spdx),
      projectRoot,
      {
        copyrightHolder: config.copyrightHolder,
        year: config.copyrightYear,
      },
      {},
    );
  },
  'package.json': (tree, projectRoot, config) => {
    const packageJsonPath = joinPathFragments(projectRoot, 'package.json');
    if (tree.exists(packageJsonPath)) {
      updateJson(tree, packageJsonPath, (prev) => ({
        ...prev,
        license: config.spdx,
      }));
    }
  },
  'pyproject.toml': (tree, projectRoot, config) => {
    const pyProjectPath = joinPathFragments(projectRoot, 'pyproject.toml');
    if (tree.exists(pyProjectPath)) {
      updateToml(tree, pyProjectPath, (prev) => ({
        ...prev,
        license: config.spdx,
        ...(tree.exists(joinPathFragments(projectRoot, 'LICENSE'))
          ? {
              'license-files': ['LICENSE'],
            }
          : {}),
      }));
    }
  },
};

/**
 * Synchronise a particular project file
 */
export const syncProjectFile = (
  tree: Tree,
  projectRoot: string,
  projectFile: (typeof PROJECT_FILES_TO_SYNC)[number],
  config: LicenseConfig,
) => {
  return SYNC_STRATEGIES[projectFile](tree, projectRoot, config);
};
