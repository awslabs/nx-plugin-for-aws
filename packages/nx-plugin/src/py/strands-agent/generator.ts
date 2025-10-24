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
  updateProjectConfiguration,
} from '@nx/devkit';
import { PyStrandsAgentGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { kebabCase, toSnakeCase, toClassName } from '../../utils/names';
import {
  addDependenciesToDependencyGroupInPyProjectToml,
  addDependenciesToPyProjectToml,
} from '../../utils/py';
import { addAgentInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { getNpmScope } from '../../utils/npm-scope';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { Logger } from '@nxlv/python/src/executors/utils/logger';
import { UVProvider } from '@nxlv/python/src/provider/uv/provider';
import { resolveIacProvider } from '../../utils/iac';
import { assignPort } from '../../utils/port';

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
  const agentTargetPrefix = options.name ? name : 'agent';

  const agentNameSnakeCase = toSnakeCase(options.name ?? 'agent');
  const agentNameClassName = toClassName(name);

  const targetSourceDir = joinPathFragments(
    project.sourceRoot,
    agentNameSnakeCase,
  );

  const computeType = options.computeType ?? 'BedrockAgentCoreRuntime';

  // Generate example agent
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app'),
    targetSourceDir,
    {
      name,
      agentNameSnakeCase,
      agentNameClassName,
      moduleName,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPyProjectToml(tree, project.root, [
    'aws-opentelemetry-distro',
    'bedrock-agentcore',
    'fastapi',
    'boto3',
    'mcp',
    'strands-agents',
    'strands-agents-tools',
    'uvicorn',
  ]);
  addDependenciesToDependencyGroupInPyProjectToml(tree, project.root, 'dev', [
    'fastapi[standard]',
  ]);

  if (computeType === 'BedrockAgentCoreRuntime') {
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    const { bundleTargetName, bundleOutputDir } = addPythonBundleTarget(
      project,
      {
        pythonPlatform: 'aarch64-manylinux2014',
      },
    );

    // Add the Dockerfile
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'deploy'),
      targetSourceDir,
      {
        agentNameSnakeCase,
        moduleName,
        bundleOutputDir,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    const dockerTargetName = `${agentTargetPrefix}-docker`;

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
      dependsOn: [bundleTargetName],
    };

    addDependencyToTargetIfNotPresent(project, 'docker', dockerTargetName);
    addDependencyToTargetIfNotPresent(project, 'build', 'docker');

    // Add shared constructs
    const iacProvider = await resolveIacProvider(tree, options.iacProvider);
    await sharedConstructsGenerator(tree, { iacProvider });

    // Add the construct to deploy the agent
    addAgentInfra(tree, {
      agentNameKebabCase: name,
      agentNameClassName,
      dockerImageTag,
      iacProvider,
      projectName: project.name,
    });
  }

  // NB: we assign the local dev port from 8081 as 8080 is used by vscode server, and so conflicts
  // for those working on remote dev envirionments. The deployed agent in agentcore still runs on
  // 8080 as per the agentcore contract.
  const localDevPort = assignPort(tree, project, 8081);

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: {
      ...project.targets,
      [`${agentTargetPrefix}-serve`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `uv run fastapi dev ${moduleName}/${agentNameSnakeCase}/main.py --port ${localDevPort}`,
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
    PY_STRANDS_AGENT_GENERATOR_INFO,
    agentTargetPrefix,
    {
      port: localDevPort,
    },
  );

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
