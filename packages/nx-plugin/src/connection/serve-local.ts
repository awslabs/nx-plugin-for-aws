/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQLTransform } from '../utils/ast';
import { readProjectConfigurationUnqualified } from '../utils/nx';
import { toClassName } from '../utils/names';

export interface ServeLocalOptions {
  apiName: string;
  url: string;
  additionalDependencyTargets?: string[];
}

/**
 * Adds the given target project to the source project's serve-local target
 * Updates the runtime config provider (if it exists)
 */
export const addTargetToServeLocal = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: ServeLocalOptions,
) => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    sourceProjectName,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    targetProjectName,
  );

  // Target project must have a serve target which is continuous
  if (
    !(
      targetProject.targets?.serve?.continuous &&
      sourceProject.targets?.['serve-local']
    )
  ) {
    return;
  }

  // Add a dependency on the serve target
  sourceProject.targets['serve-local'].dependsOn = [
    ...(sourceProject.targets['serve-local'].dependsOn ?? []),
    {
      projects: [targetProject.name],
      target: 'serve',
    },
    ...(options.additionalDependencyTargets ?? []),
  ];
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  // Add an override to runtime-config.json for the serve-local target to use the local url
  const runtimeConfigProvider = joinPathFragments(
    sourceProject.root,
    'src',
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (tree.exists(runtimeConfigProvider)) {
    const className = toClassName(options.apiName);
    await applyGritQLTransform(
      tree,
      runtimeConfigProvider,
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.apis.${className} = '${options.url}';\n  }\` where { $cond <: contains \`'serve-local'\`, $stmts <: within \`const applyOverrides = $_\` }`,
    );
  }
};
