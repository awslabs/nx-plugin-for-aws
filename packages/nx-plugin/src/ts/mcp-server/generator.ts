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
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { withVersions } from '../../utils/versions';
import { kebabCase, toClassName } from '../../utils/names';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { addMcpServerInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { getNpmScope } from '../../utils/npm-scope';
import { resolveIacProvider } from '../../utils/iac';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { assignPort } from '../../utils/port';

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
  const mcpTargetPrefix = options.name ? name : 'mcp-server';
  const targetSourceDirRelativeToProjectRoot = joinPathFragments(
    'src',
    mcpTargetPrefix,
  );
  const targetSourceDir = joinPathFragments(
    project.root,
    targetSourceDirRelativeToProjectRoot,
  );
  const relativeSourceDir = targetSourceDir.replace(project.root + '/', './');
  const distDir = joinPathFragments('dist', project.root);

  const computeType = options.computeType ?? 'BedrockAgentCoreRuntime';

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

  // Add a target for running the MCP server with stdio transport
  // This allows for the project to be published to npm and then configured with npx, ie:
  // npx -p my-package mcp-server
  updateJson(tree, projectPackageJsonPath, (pkg) => {
    pkg.bin ??= {};
    pkg.bin[name] = `${relativeSourceDir}/stdio.js`;
    return pkg;
  });

  // Generate example server
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    targetSourceDir,
    {
      name,
      esm,
      distDir,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add dependencies
  // Note here we depend on zod v3 (default zod is v4 for all other generators)
  // Zod v3 is needed since the MCP SDK doesn't yet support v4 (or both v3 and v4 via standard schema)
  // Tracking: https://github.com/modelcontextprotocol/typescript-sdk/issues/164
  // We use a renamed dependency so that v3 and v4 can coexist in projects until the above is resolved
  const deps = withVersions(['@modelcontextprotocol/sdk', 'zod-v3', 'express']);
  const devDeps = withVersions([
    'tsx',
    '@types/express',
    '@modelcontextprotocol/inspector',
  ]);

  // Add hosting based on compute type
  if (computeType === 'BedrockAgentCoreRuntime') {
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    addTypeScriptBundleTarget(tree, project, {
      targetFilePath: `${targetSourceDirRelativeToProjectRoot}/http.ts`,
      bundleOutputDir: joinPathFragments('mcp', name),
    });

    const dockerTargetName = `${mcpTargetPrefix}-docker`;

    project.targets[dockerTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        command: `docker build --platform linux/arm64 -t ${dockerImageTag} ${targetSourceDir} --build-context workspace=.`,
      },
      dependsOn: ['bundle'],
    };

    addDependencyToTargetIfNotPresent(project, 'docker', dockerTargetName);
    addDependencyToTargetIfNotPresent(project, 'build', 'docker');

    // Add shared constructs
    const iacProvider = await resolveIacProvider(tree, options.iacProvider);
    await sharedConstructsGenerator(tree, { iacProvider });

    // Add the construct to deploy the mcp server
    addMcpServerInfra(tree, {
      mcpServerNameKebabCase: name,
      mcpServerNameClassName: toClassName(name),
      projectName: project.name,
      dockerImageTag,
      iacProvider,
    });
  } else {
    // No Dockerfile needed for non-hosted MCP
    tree.delete(joinPathFragments(targetSourceDir, 'Dockerfile'));
  }

  addDependenciesToPackageJson(tree, deps, devDeps);
  addDependenciesToPackageJson(tree, deps, devDeps, projectPackageJsonPath);

  const localDevPort = assignPort(tree, project, 8000);

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: {
      ...project.targets,
      // Add targets for running the MCP server
      [`${mcpTargetPrefix}-serve-stdio`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`tsx --watch ${relativeSourceDir}/stdio.ts`],
          cwd: '{projectRoot}',
        },
        continuous: true,
      },
      [`${mcpTargetPrefix}-serve`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`tsx --watch ${relativeSourceDir}/http.ts`],
          cwd: '{projectRoot}',
          env: {
            PORT: `${localDevPort}`,
          },
        },
        continuous: true,
      },
      [`${mcpTargetPrefix}-inspect`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `mcp-inspector -- tsx --watch ${relativeSourceDir}/stdio.ts`,
          ],
          cwd: '{projectRoot}',
        },
        continuous: true,
      },
    },
  });

  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_MCP_SERVER_GENERATOR_INFO,
    mcpTargetPrefix,
    {
      port: localDevPort,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_MCP_SERVER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsMcpServerGenerator;
