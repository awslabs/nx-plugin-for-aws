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
import { FsCommands } from '../../utils/fs';
import { getNpmScope } from '../../utils/npm-scope';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { Logger, UVProvider } from '../../utils/nxlv-python';
import { resolveIacProvider } from '../../utils/iac';
import { assignPort } from '../../utils/port';
import { toProjectRelativePath } from '../../utils/paths';

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
    options.name || `${kebabCase(project.name.split('.').pop())}-agent`,
  );
  const agentTargetPrefix = options.name ? name : 'agent';

  const agentNameSnakeCase = toSnakeCase(options.name || 'agent');
  const agentNameClassName = toClassName(name);

  const targetSourceDir = joinPathFragments(
    project.sourceRoot,
    agentNameSnakeCase,
  );

  const computeType = options.computeType ?? 'BedrockAgentCoreRuntime';
  const auth = options.auth ?? 'IAM';
  const protocol = options.protocol ?? 'HTTP';

  const templateContext = {
    name,
    agentNameSnakeCase,
    agentNameClassName,
    moduleName,
  };

  // Generate common files shared by both protocols
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'common'),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Generate protocol-specific files
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', protocol.toLowerCase()),
    targetSourceDir,
    templateContext,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPyProjectToml(tree, project.root, [
    'aws-lambda-powertools',
    'aws-opentelemetry-distro',
    'bedrock-agentcore',
    'boto3',
    'fastapi',
    'mcp',
    ...(protocol === 'A2A'
      ? (['strands-agents[a2a]'] as const)
      : (['strands-agents'] as const)),
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
        pythonPlatform: 'aarch64-manylinux_2_28',
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
        protocol,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    const dockerOutputDir = joinPathFragments(
      'dist',
      project.root,
      'docker',
      name,
    );
    const dockerTargetName = `${agentTargetPrefix}-docker`;

    // Add a docker target that prepares the docker context and builds the image
    const fs = new FsCommands(tree);
    project.targets[dockerTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.rm(dockerOutputDir),
          fs.cp(bundleOutputDir, dockerOutputDir),
          fs.cp(
            `${targetSourceDir}/Dockerfile`,
            `${dockerOutputDir}/Dockerfile`,
          ),
          `docker build --platform linux/arm64 -t ${dockerImageTag} ${dockerOutputDir}`,
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
    await addAgentInfra(tree, {
      agentNameKebabCase: name,
      agentNameClassName,
      dockerImageTag,
      dockerOutputDir,
      iacProvider,
      projectName: project.name,
      auth,
      serverProtocol: protocol,
    });
  }

  // A2A servers use port 9000 as per the Strands A2A SDK default and AgentCore A2A contract.
  // HTTP agents use port 8081+ to avoid conflict with VS Code server on 8080.
  const localDevPortStart = protocol === 'A2A' ? 9000 : 8081;
  const localDevPort = assignPort(tree, project, localDevPortStart);

  // Both protocols use fastapi dev for hot reload:
  // - HTTP: FastAPI app directly defined in init.py
  // - A2A: A2AServer.to_fastapi_app() creates a FastAPI app in main.py
  const serveCommand = `uv run fastapi dev ${moduleName}/${agentNameSnakeCase}/main.py --port ${localDevPort}`;

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: {
      ...project.targets,
      [`${agentTargetPrefix}-serve`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [serveCommand],
          cwd: '{projectRoot}',
          env: {
            PORT: `${localDevPort}`,
          },
        },
        continuous: true,
      },
      [`${agentTargetPrefix}-serve-local`]: {
        executor: 'nx:run-commands',
        options: {
          commands: [serveCommand],
          cwd: '{projectRoot}',
          env: {
            PORT: `${localDevPort}`,
            SERVE_LOCAL: 'true',
          },
        },
        continuous: true,
      },
    },
  });

  addComponentGeneratorMetadata(
    tree,
    project.name,
    PY_STRANDS_AGENT_GENERATOR_INFO,
    toProjectRelativePath(project, targetSourceDir),
    agentTargetPrefix,
    {
      port: localDevPort,
      rc: agentNameClassName,
      auth,
      protocol,
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
