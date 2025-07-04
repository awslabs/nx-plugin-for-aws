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
  readJson,
  updateJson,
  updateProjectConfiguration,
  writeJson,
} from '@nx/devkit';
import { TsMcpServerGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { withVersions } from '../../utils/versions';
import { kebabCase } from '../../utils/names';

export const TS_MCP_SERVER_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsMcpServerGenerator = async (
  tree: Tree,
  options: TsMcpServerGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);

  if (!tree.exists(joinPathFragments(project.root, 'tsconfig.json'))) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a TypeScript project (with a tsconfig.json)`,
    );
  }

  const defaultName = `${kebabCase(project.name.split('/').pop())}-mcp-server`;
  const name = kebabCase(options.name ?? defaultName);
  const targetSourceDir = joinPathFragments(
    project.sourceRoot ?? `${project.root}/src`,
    options.name ? name : 'mcp-server',
  );
  const relativeSourceDir = targetSourceDir.replace(project.root + '/', './');

  // Create a package.json if one doesn't exist, since we want to add the server as a bin target
  const projectPackageJsonPath = joinPathFragments(
    project.root,
    'package.json',
  );
  if (!tree.exists(projectPackageJsonPath)) {
    // Default to esm if no package.json found
    writeJson(tree, projectPackageJsonPath, {
      name: project.name,
      type: 'module',
    });
  }

  // Generate esm if the package.json is of type module, otherwise we generate commonjs
  // We support commonjs here because nx plugins must be commonjs
  // https://github.com/nrwl/nx/issues/15682
  const esm = readJson(tree, projectPackageJsonPath).type === 'module';

  // Add a target for running the MCP server
  updateJson(tree, projectPackageJsonPath, (pkg) => {
    pkg.bin ??= {};
    pkg.bin[name] = `${relativeSourceDir}/index.js`;
    return pkg;
  });

  // Add dependencies
  const deps = withVersions(['@modelcontextprotocol/sdk', 'zod']);
  const devDeps = withVersions(['tsx']);
  addDependenciesToPackageJson(tree, deps, devDeps);
  addDependenciesToPackageJson(tree, deps, devDeps, projectPackageJsonPath);

  // Generate example server
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    targetSourceDir,
    {
      name,
      esm,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: {
      ...project.targets,
      // Add target for running the MCP server
      [`${options.name ? name : 'mcp-server'}-serve`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`tsx --watch ${relativeSourceDir}/index.ts`],
          cwd: '{projectRoot}',
        },
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
