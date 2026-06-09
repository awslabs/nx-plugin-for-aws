/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import tsProjectGenerator, { getTsLibDetails } from '../lib/generator';
import tsMcpServerGenerator from '../mcp-server/generator';
import type { TsNxPluginGeneratorSchema } from './schema';
import { configureTsProjectAsNxPlugin } from './utils';

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
        outputPath: `dist/{projectRoot}/package`,
        main: `{projectRoot}/src/index.ts`,
        tsConfig: `{projectRoot}/tsconfig.lib.json`,
        assets: [
          `{projectRoot}/*.md`,
          `{projectRoot}/LICENSE*`,
          `{projectRoot}/NOTICE`,
          {
            input: './{projectRoot}/src',
            glob: '**/!(*.ts)',
            output: './src',
          },
          {
            input: './{projectRoot}/src',
            glob: '**/*.d.ts',
            output: './src',
          },
          {
            input: './{projectRoot}',
            glob: 'generators.json',
            output: '.',
          },
          {
            input: './{projectRoot}',
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

  // Add an MCP Server
  await tsMcpServerGenerator(tree, {
    project: fullyQualifiedName,
    infra: 'none',
    iac: 'cdk', // not used
  });

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

  addGeneratorMetadata(tree, project.name, TS_NX_PLUGIN_GENERATOR_INFO);

  await addGeneratorMetricsIfApplicable(tree, [TS_NX_PLUGIN_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsNxPluginGenerator;
