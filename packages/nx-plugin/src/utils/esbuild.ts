/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProjectConfiguration } from '@nx/devkit';

export interface AddEsbuildBundleTargetProps {
  bundleTargetName: string;
  targetFilePath: string;
  extraEsbuildArgs?: string;
  postBundleCommands?: string[];
}

/**
 * Mutates the given project with an esbuild bundle target, and hooks up dependencies
 */
export const addEsbuildBundleTarget = (
  projectConfig: ProjectConfiguration,
  {
    bundleTargetName,
    targetFilePath,
    extraEsbuildArgs,
    postBundleCommands,
  }: AddEsbuildBundleTargetProps,
): void => {
  // Make sure the project has targets
  if (!projectConfig.targets) {
    projectConfig.targets = {};
  }

  // Add the bundle target
  projectConfig.targets[bundleTargetName] = {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${projectConfig.root}/${bundleTargetName}`],
    options: {
      commands: [
        `esbuild ${targetFilePath} --bundle --platform=node --target=node22 --format=cjs --outfile=dist/${projectConfig.root}/${bundleTargetName}/index.js${extraEsbuildArgs ? ` ${extraEsbuildArgs}` : ''}`,
        ...(postBundleCommands ?? []),
      ],
      parallel: false,
    },
    dependsOn: ['compile'],
  };

  // Add the bundle target if it doesn't exist
  projectConfig.targets.bundle = projectConfig.targets.bundle ?? {
    cache: true,
    dependsOn: [],
  };
  // Add the esbuild bundle target to the main bundle target's dependsOn
  projectConfig.targets.bundle.dependsOn = [
    ...(projectConfig.targets.bundle.dependsOn ?? []).filter(
      (d) => d !== bundleTargetName,
    ),
    bundleTargetName,
  ];

  if (!projectConfig.targets?.build) {
    projectConfig.targets.build = {};
  }

  projectConfig.targets.build.dependsOn = [
    ...(projectConfig.targets.build.dependsOn ?? []).filter(
      (t) => t !== 'bundle',
    ),
    'bundle',
  ];
};
