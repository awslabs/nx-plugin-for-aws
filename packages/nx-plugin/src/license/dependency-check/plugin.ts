/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CreateNodesV2 } from '@nx/devkit';

export interface LicenseCheckPluginOptions {
  targetName?: string;
}

const buildTarget = () => ({
  cache: true,
  inputs: [
    '{workspaceRoot}/pnpm-lock.yaml',
    '{workspaceRoot}/yarn.lock',
    '{workspaceRoot}/package-lock.json',
    '{workspaceRoot}/bun.lockb',
    '{workspaceRoot}/aws-nx-plugin.config.mts',
  ],
  executor: '@aws/nx-plugin:license-check' as const,
  options: {},
});

/**
 * Registers a `license-check` target on the workspace root project.
 * Matches `aws-nx-plugin.config.mts` to avoid interfering with generators
 * that create new project.json files.
 */
export const createNodesV2: CreateNodesV2<LicenseCheckPluginOptions> = [
  'aws-nx-plugin.config.mts',
  (configFilePaths, options) => {
    if (configFilePaths.length === 0) return [];
    const targetName = options?.targetName ?? 'license-check';
    return [
      [
        configFilePaths[0],
        {
          projects: {
            '.': {
              targets: {
                [targetName]: buildTarget(),
                lint: { dependsOn: [targetName] },
                build: { dependsOn: [targetName] },
              },
            },
          },
        },
      ],
    ];
  },
];

export const createNodes = createNodesV2;
