/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsNxPluginGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import { configureTsProjectAsNxPlugin } from './utils';
import tsMcpServerGenerator from '../mcp-server/generator';

export const TS_NX_PLUGIN_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsNxPluginGenerator = async (
  tree: Tree,
  options: TsNxPluginGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Generate a TypeScript project as the base
  const { fullyQualifiedName, dir } = getTsLibDetails(tree, options);
  await tsProjectGenerator(tree, options);

  // Configure the typescript project as an Nx Plugin
  configureTsProjectAsNxPlugin(tree, fullyQualifiedName);

  // Add a "package" target which creates a package which can be published to NPM
  const project = readProjectConfigurationUnqualified(tree, fullyQualifiedName);
  project.targets = {
    ...project.targets,
    package: {
      executor: '@nx/js:tsc',
      outputs: ['{options.outputPath}'],
      options: {
        outputPath: `dist/${dir}/package`,
        main: `${dir}/src/index.ts`,
        tsConfig: `${dir}/tsconfig.lib.json`,
        assets: [
          `${dir}/*.md`,
          `${dir}/LICENSE*`,
          `${dir}/NOTICE`,
          {
            input: `./${dir}/src`,
            glob: '**/!(*.ts)',
            output: './src',
          },
          {
            input: `./${dir}/src`,
            glob: '**/*.d.ts',
            output: './src',
          },
          {
            input: `./${dir}`,
            glob: 'generators.json',
            output: '.',
          },
          {
            input: `./${dir}`,
            glob: 'executors.json',
            output: '.',
          },
        ],
      },
    },
    build: {
      dependsOn: [
        ...(project.targets?.build?.dependsOn ?? []).filter(
          (d) => typeof d !== 'string' || d !== 'package',
        ),
        'package',
      ],
    },
  };
  updateProjectConfiguration(tree, fullyQualifiedName, project);

  // Remove the hello world example from index.ts
  tree.write(joinPathFragments(project.sourceRoot, 'index.ts'), '');

  // Add an MCP Server
  await tsMcpServerGenerator(tree, { project: fullyQualifiedName });

  const mcpPath = joinPathFragments(project.sourceRoot, 'mcp-server');
  const mcpServerPath = joinPathFragments(mcpPath, 'server.ts');

  // Remove the sample server and tools
  tree.delete(mcpServerPath);
  tree.delete(joinPathFragments(mcpPath, 'tools', 'add.ts'));
  tree.delete(joinPathFragments(mcpPath, 'resources', 'sample-guidance.ts'));

  // Add generator MCP server
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'mcp-server'),
    mcpPath,
    {
      name: fullyQualifiedName,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_NX_PLUGIN_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsNxPluginGenerator;
