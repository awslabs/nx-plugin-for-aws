/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQL } from '../utils/ast';
import { toClassName } from '../utils/names';
import {
  addDependencyToTargetIfNotPresent,
  readProjectConfigurationUnqualified,
} from '../utils/nx';

export interface LocalDevOptions {
  apiName: string;
  url: string;
  additionalDependencyTargets?: string[];
}

/**
 * Adds the given target project to the source project's dev target
 * Updates the runtime config provider (if it exists)
 */
export const addTargetToLocalDev = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: LocalDevOptions,
) => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    sourceProjectName,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    targetProjectName,
  );

  // Target project must have a dev target which is continuous
  if (
    !(
      targetProject.targets?.['dev']?.continuous &&
      sourceProject.targets?.['dev']
    )
  ) {
    return;
  }

  // Add a dependency on the dev target
  addDependencyToTargetIfNotPresent(sourceProject, 'dev', {
    projects: [targetProject.name],
    target: 'dev',
  });
  for (const additional of options.additionalDependencyTargets ?? []) {
    addDependencyToTargetIfNotPresent(sourceProject, 'dev', additional);
  }
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  // Add an override to runtime-config.json for the dev target to use the local url
  const runtimeConfigProvider = joinPathFragments(
    sourceProject.root,
    'src',
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (tree.exists(runtimeConfigProvider)) {
    const className = toClassName(options.apiName);
    await applyGritQL(
      tree,
      runtimeConfigProvider,
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.apis.${className} = '${options.url}';\n  }\` where { $cond <: contains \`'local-dev'\`, $stmts <: within \`const applyOverrides = $_\`, $stmts <: not contains \`runtimeConfig.apis.${className}\` }`,
    );
  }
};
