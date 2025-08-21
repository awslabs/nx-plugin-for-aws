/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { TargetConfiguration } from '@nx/devkit';

export interface CreatePythonBundleTargetOptions {
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
export const createPythonBundleTarget = ({
  projectDir,
  packageName,
}: CreatePythonBundleTargetOptions): TargetConfiguration => {
  return {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [`{workspaceRoot}/dist/${projectDir}/bundle`],
    options: {
      commands: [
        `uv export --frozen --no-dev --no-editable --project ${projectDir} --package ${packageName} -o dist/${projectDir}/bundle/requirements.txt`,
        `uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform x86_64-manylinux2014 --target dist/${projectDir}/bundle -r dist/${projectDir}/bundle/requirements.txt`,
      ],
      parallel: false,
    },
  };
};
