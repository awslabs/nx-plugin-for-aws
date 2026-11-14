/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQL } from '../utils/ast.js';
import { toClassName } from '../utils/names.js';
import {
  addDependencyToTargetIfNotPresent,
  readProjectConfigurationUnqualified,
} from '../utils/nx.js';

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

export interface ContainerServiceLocalDevOptions {
  /** The service's runtime-config key under `services`, eg `MyService`. */
  serviceClassName: string;
  /** Local port the service's serve target listens on. */
  port: number;
  /** The container project's serve target, eg `my-service-serve`. */
  serveTarget: string;
}

/**
 * Makes the website's dev target start a container service's serve target,
 * and points the service's runtime-config entry at it for local dev.
 */
export const addContainerServiceTargetToLocalDev = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: ContainerServiceLocalDevOptions,
) => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    sourceProjectName,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    targetProjectName,
  );

  if (
    !(
      targetProject.targets?.[options.serveTarget]?.continuous &&
      sourceProject.targets?.dev
    )
  ) {
    return;
  }

  addDependencyToTargetIfNotPresent(sourceProject, 'dev', {
    projects: [targetProject.name],
    target: options.serveTarget,
  });
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  // Spread rather than member assignment: the provider's fetch-failure
  // fallback config has no `services` key. The marker is the service's local
  // URL, unique per service.
  const runtimeConfigProvider = joinPathFragments(
    sourceProject.root,
    'src',
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (tree.exists(runtimeConfigProvider)) {
    const url = `'http://localhost:${options.port}'`;
    await applyGritQL(
      tree,
      runtimeConfigProvider,
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.services = { ...runtimeConfig.services, ${options.serviceClassName}: ${url} };\n  }\` where { $cond <: contains \`'local-dev'\`, $stmts <: within \`const applyOverrides = $_\`, $stmts <: not contains \`${url}\` }`,
    );
  }
};
