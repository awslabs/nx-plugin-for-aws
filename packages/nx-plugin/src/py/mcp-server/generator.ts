/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  ProjectConfiguration,
  Tree,
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PyMcpServerGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { kebabCase, toClassName, toSnakeCase } from '../../utils/names';
import { addDependenciesToPyProjectToml } from '../../utils/py';
import { getNpmScope } from '../../utils/npm-scope';
import { addMcpServerConstruct } from '../../utils/agent-core-constructs/agent-core-constructs';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { addPythonBundleTarget } from '../../utils/bundle';
import { withVersions } from '../../utils/versions';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';

export const PY_MCP_SERVER_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyMcpServerGenerator = async (
  tree: Tree,
  options: PyMcpServerGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);

  const pyProjectPath = joinPathFragments(project.root, 'pyproject.toml');

  // Check if the project has a pyproject.toml file
  if (!pyProjectPath) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a Python project (with a pyproject.toml)`,
    );
  }

  if (!project.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  // Module name is the last part of the source root,
  const sourceParts = project.sourceRoot.split('/');
  const moduleName = sourceParts[sourceParts.length - 1];

  const name = kebabCase(
    options.name ?? `${kebabCase(project.name.split('.').pop())}-mcp-server`,
  );

  const mcpServerNameSnakeCase = toSnakeCase(options.name ?? 'mcp-server');
  const mcpServerNameClassName = toClassName(name);

  const targetSourceDir = joinPathFragments(
    project.sourceRoot,
    mcpServerNameSnakeCase,
  );
  const distDir = joinPathFragments('dist', project.root);

  // Generate example server
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    targetSourceDir,
    {
      name,
      mcpServerNameSnakeCase,
      mcpServerNameClassName,
      moduleName,
      distDir,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPyProjectToml(tree, project.root, ['mcp']);

  if (options.computeType === 'BedrockAgentCoreRuntime') {
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    addPythonBundleTarget(project, {
      pythonPlatform: 'aarch64-manylinux2014',
    });

    const dockerTargetName = `${name}-docker`;

    // Add a docker target specific to this MCP server
    project.targets[dockerTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        commands: [
          `docker build --platform linux/arm64 -t ${dockerImageTag} ${targetSourceDir} --build-context workspace=.`,
        ],
        parallel: false,
      },
      dependsOn: ['bundle'],
    };

    project.targets.docker = {
      ...project.targets.docker,
      dependsOn: [
        ...(project.targets.docker?.dependsOn ?? []).filter(
          (t) => t !== dockerTargetName,
        ),
        dockerTargetName,
      ],
    };

    project.targets.build = {
      ...project.targets.build,
      dependsOn: [
        ...(project.targets.build?.dependsOn ?? []).filter(
          (t) => t !== 'docker',
        ),
        'docker',
      ],
    };

    // Add shared constructs
    await sharedConstructsGenerator(tree);

    // Ensure common constructs builds after our mcp server project
    updateJson(
      tree,
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
      (config: ProjectConfiguration) => {
        if (!config.targets) {
          config.targets = {};
        }
        if (!config.targets.build) {
          config.targets.build = {};
        }
        config.targets.build.dependsOn = [
          ...(config.targets.build.dependsOn ?? []).filter(
            (t) => t !== `${project.name}:build`,
          ),
          `${project.name}:build`,
        ];
        return config;
      },
    );

    // Add the construct to deploy the mcp server
    addMcpServerConstruct(tree, {
      mcpServerNameKebabCase: name,
      mcpServerNameClassName,
      dockerImageTag,
    });

    addDependenciesToPackageJson(
      tree,
      {},
      withVersions(['@aws-sdk/client-bedrock-agentcore-control']),
    );
  } else {
    // No Dockerfile needed for non-hosted MCP
    tree.delete(joinPathFragments(targetSourceDir, 'Dockerfile'));
  }

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: {
      ...project.targets,
      // Add targets for running the MCP server
      [`${options.name ? name : 'mcp-server'}-serve-stdio`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`uv run -m ${moduleName}.${mcpServerNameSnakeCase}.stdio`],
          cwd: '{projectRoot}',
        },
      },
      [`${options.name ? name : 'mcp-server'}-serve-http`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [`uv run -m ${moduleName}.${mcpServerNameSnakeCase}.http`],
          cwd: '{projectRoot}',
        },
      },
      [`${options.name ? name : 'mcp-server'}-inspect`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `mcp-inspector -- uv run -m ${moduleName}.${mcpServerNameSnakeCase}.stdio`,
          ],
          cwd: '{projectRoot}',
        },
      },
    },
  });

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@modelcontextprotocol/inspector']),
  );

  await addGeneratorMetricsIfApplicable(tree, [PY_MCP_SERVER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return async () => {
    installPackagesTask(tree);
    await new UVProvider(tree.root, new Logger(), tree).install();
  };
};

export default pyMcpServerGenerator;
