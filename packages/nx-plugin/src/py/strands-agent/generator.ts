/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  ProjectConfiguration,
  Tree,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PyStrandsAgentGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { kebabCase, toSnakeCase, toClassName } from '../../utils/names';
import { addDependenciesToPyProjectToml } from '../../utils/py';
import { addAgentConstruct } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addPythonBundleTarget } from '../../utils/bundle';
import { getNpmScope } from '../../utils/npm-scope';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';

export const PY_STRANDS_AGENT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyStrandsAgentGenerator = async (
  tree: Tree,
  options: PyStrandsAgentGeneratorSchema,
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
    options.name ?? `${kebabCase(project.name.split('.').pop())}-agent`,
  );

  const agentNameSnakeCase = toSnakeCase(options.name ?? 'agent');
  const agentNameClassName = toClassName(name);

  const targetSourceDir = joinPathFragments(
    project.sourceRoot,
    agentNameSnakeCase,
  );
  const distDir = joinPathFragments('dist', project.root);

  const computeType = options.computeType ?? 'BedrockAgentCoreRuntime';

  // Generate example agent
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    targetSourceDir,
    {
      name,
      agentNameSnakeCase,
      agentNameClassName,
      moduleName,
      distDir,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPyProjectToml(tree, project.root, [
    'aws-opentelemetry-distro',
    'bedrock-agentcore',
    'boto3',
    'mcp',
    'strands-agents',
    'strands-agents-tools',
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
    await sharedConstructsGenerator(tree);

    // Ensure common constructs builds after our agent project
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

    // Add the construct to deploy the agent
    addAgentConstruct(tree, {
      agentNameKebabCase: name,
      agentNameClassName,
      dockerImageTag,
    });
  } else {
    // No Dockerfile needed for non-hosted Agent
    tree.delete(joinPathFragments(targetSourceDir, 'Dockerfile'));
  }

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: {
      ...project.targets,
      // TODO: Add hot-reload
      [`${options.name ? name : 'agent'}-serve`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `uv run python -m ${moduleName}.${agentNameSnakeCase}.main`,
          ],
          cwd: '{projectRoot}',
        },
        continuous: true,
      },
    },
  });

  await addGeneratorMetricsIfApplicable(tree, [
    PY_STRANDS_AGENT_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return async () => {
    installPackagesTask(tree);
    await new UVProvider(tree.root, new Logger(), tree).install();
  };
};

export default pyStrandsAgentGenerator;
