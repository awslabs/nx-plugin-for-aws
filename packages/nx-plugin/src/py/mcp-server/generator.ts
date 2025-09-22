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
import { addMcpServerInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { withVersions } from '../../utils/versions';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';
import { resolveIacProvider } from '../../utils/iac';

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

  const computeType = options.computeType ?? 'BedrockAgentCoreRuntime';

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

  addDependenciesToPyProjectToml(tree, project.root, [
    'mcp',
    'boto3',
    'aws-opentelemetry-distro',
  ]);

  if (computeType === 'BedrockAgentCoreRuntime') {
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
    const iacProvider = await resolveIacProvider(tree, options.iacProvider);
    await sharedConstructsGenerator(tree, { iacProvider });

    // Add the construct to deploy the mcp server
    addMcpServerInfra(tree, {
      mcpServerNameKebabCase: name,
      mcpServerNameClassName,
      projectName: project.name,
      dockerImageTag,
      iacProvider,
    });
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
