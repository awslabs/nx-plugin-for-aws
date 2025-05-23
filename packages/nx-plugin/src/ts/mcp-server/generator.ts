/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  readProjectConfiguration,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsMcpServerGeneratorSchema } from './schema';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import { withVersions } from '../../utils/versions';

export const TS_MCP_SERVER_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsMcpServerGenerator = async (
  tree: Tree,
  options: TsMcpServerGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Generate a TypeScript library
  await tsProjectGenerator(tree, options);

  const { fullyQualifiedName } = getTsLibDetails(tree, options);
  const project = readProjectConfiguration(tree, fullyQualifiedName);

  // Add dependencies
  const deps = withVersions(['@modelcontextprotocol/sdk', 'zod']);
  const devDeps = withVersions(['tsx', 'esbuild']);
  addDependenciesToPackageJson(tree, deps, devDeps);

  // Generate example server
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    project.root,
    {
      name: options.name,
      dir: project.root,
    },
    { overwriteStrategy: OverwriteStrategy.Overwrite },
  );

  // Add build targets
  updateProjectConfiguration(tree, fullyQualifiedName, {
    ...project,
    targets: {
      ...project?.targets,
      // Bundle with esbuild
      bundle: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `esbuild "${joinPathFragments(project.sourceRoot, 'index.ts')}" --bundle --platform=node --format=esm --loader:.md=text --outfile=${joinPathFragments('dist', project.root, 'bundle', 'index.js')}`,
          ],
        },
      },
      // Dev task for bundling whenever changes are made
      dev: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `nx watch --projects=${fullyQualifiedName} --includeDependentProjects -- nx run ${fullyQualifiedName}:bundle`,
          ],
        },
      },
      // Ensure bundle runs as part of build
      build: {
        ...project?.targets?.build,
        dependsOn: [...(project?.targets?.build?.dependsOn ?? []), 'bundle'],
      },
    },
  });

  await addGeneratorMetricsIfApplicable(tree, [TS_MCP_SERVER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsMcpServerGenerator;
