/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProjectConfiguration, TargetConfiguration } from '@nx/devkit';

export interface AddPythonBundleTargetOptions {
  /**
   * Python platform
   * @default x86_64-manylinux2014
   */
  pythonPlatform?: 'x86_64-manylinux2014' | 'aarch64-manylinux2014';
}

interface CreatePythonBundleTargetOptions
  extends Required<AddPythonBundleTargetOptions> {
  /**
   * Directory of the python project from the monorepo root
   */
  projectDir: string;

  /**
   * Python package name
   */
  packageName: string;
}

/**
 * Create a target for bundling a python project
 */
const createPythonBundleTarget = ({
  projectDir,
  packageName,
  pythonPlatform,
}: CreatePythonBundleTargetOptions): TargetConfiguration => {
  return {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${projectDir}/bundle`],
    options: {
      commands: [
        `uv export --frozen --no-dev --no-editable --project ${projectDir} --package ${packageName} -o dist/${projectDir}/bundle/requirements.txt`,
        `uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform ${pythonPlatform} --target dist/${projectDir}/bundle -r dist/${projectDir}/bundle/requirements.txt`,
      ],
      parallel: false,
    },
  };
};

/**
 * Adds a bundle target to the given project if it does not exist, and updates the build target to depend on it
 */
export const addPythonBundleTarget = (
  project: ProjectConfiguration,
  opts?: AddPythonBundleTargetOptions,
) => {
  if (!project.targets) {
    project.targets = {};
  }

  if (!project.targets?.bundle) {
    project.targets.bundle = {
      ...createPythonBundleTarget({
        projectDir: project.root,
        packageName: project.name,
        pythonPlatform: opts?.pythonPlatform ?? 'x86_64-manylinux2014',
      }),
      dependsOn: ['compile'],
    };
  }

  if (project.targets?.build) {
    project.targets.build.dependsOn = [
      ...(project.targets.build.dependsOn ?? []).filter((t) => t !== 'bundle'),
      'bundle',
    ];
  }
};
