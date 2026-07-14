/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { ensureLicenseExceptions } from '../../license/config';
import { MCP_INSPECTOR_EXCEPTIONS } from '../../license/known-exceptions';
import { addMcpServerInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addPythonBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import { addDockerImageScanCommands } from '../../utils/docker';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName, toSnakeCase } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addComponentDevTarget,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { toProjectRelativePath } from '../../utils/paths';
import { assignPort } from '../../utils/port';
import { addDependenciesToPyProjectToml } from '../../utils/py';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { withVersions } from '../../utils/versions';
import type { PyMcpServerGeneratorSchema } from './schema';

export const PY_MCP_SERVER_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

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
    options.name || `${kebabCase(project.name.split('.').pop())}-mcp-server`,
  );
  const mcpTargetPrefix = options.name ? name : 'mcp-server';

  const mcpServerNameSnakeCase = toSnakeCase(options.name || 'mcp-server');
  const mcpServerNameClassName = toClassName(name);

  const targetSourceDir = joinPathFragments(
    project.sourceRoot,
    mcpServerNameSnakeCase,
  );

  const infra = options.infra ?? 'agentcore';

  if (infra === 'none' && options.auth && options.auth !== 'iam') {
    console.warn(
      'Warning: auth is ignored when no infrastructure is configured (no infrastructure is generated)',
    );
  }

  const auth = options.auth ?? 'iam';

  // Generate example server
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'app'),
    targetSourceDir,
    {
      name,
      mcpServerNameSnakeCase,
      mcpServerNameClassName,
      moduleName,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPyProjectToml(tree, project.root, [
    'aws-lambda-powertools',
    'mcp',
    'uvicorn',
    'boto3',
    'aws-opentelemetry-distro',
  ]);

  if (infra === 'agentcore') {
    const containers = await resolveContainers(tree, 'inherit');
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    const { bundleTargetName, bundleOutputDir } = addPythonBundleTarget(
      project,
      {
        pythonPlatform: 'aarch64-manylinux_2_28',
      },
    );

    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'deploy'),
      targetSourceDir,
      {
        mcpServerNameSnakeCase,
        moduleName,
        bundleOutputDir,
      },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    const dockerOutputDir = joinPathFragments(
      'dist',
      project.root,
      'docker',
      name,
    );
    const dockerTargetName = `${mcpTargetPrefix}-docker`;

    // Add a docker target that prepares the docker context and builds the image
    const fs = new FsCommands(tree);
    project.targets[dockerTargetName] = {
      cache: true,
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.rm(dockerOutputDir),
          fs.mkdir(dockerOutputDir),
          fs.cp(bundleOutputDir, dockerOutputDir),
          fs.cp(
            `${targetSourceDir}/Dockerfile`,
            `${dockerOutputDir}/Dockerfile`,
          ),
          `${containers} build --platform linux/arm64 -t ${dockerImageTag} ${dockerOutputDir}`,
          ...addDockerImageScanCommands(tree, {
            containerEngine: containers,
            projectRoot: project.root,
            imageTags: [dockerImageTag],
          }),
        ],
        parallel: false,
      },
      dependsOn: [bundleTargetName],
    };

    addDependencyToTargetIfNotPresent(project, 'docker', dockerTargetName);
    addDependencyToTargetIfNotPresent(project, 'build', 'docker');

    // Add shared constructs
    const iac = await resolveIac(tree, options.iac);
    await sharedConstructsGenerator(tree, { iac });

    // Add the construct to deploy the mcp server
    await addMcpServerInfra(tree, {
      mcpServerNameKebabCase: name,
      mcpServerNameClassName,
      projectName: project.name,
      dockerImageTag,
      dockerOutputDir,
      iac,
      auth,
      containers,
    });
  }

  const localDevPort = assignPort(tree, project, 8000, {
    component: { info: PY_MCP_SERVER_GENERATOR_INFO, name: mcpTargetPrefix },
  });

  const mcpTargets = {
    ...project.targets,
    // Add targets for running the MCP server
    [`${mcpTargetPrefix}-serve-stdio`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [`uv run -m ${moduleName}.${mcpServerNameSnakeCase}.stdio`],
        cwd: '{projectRoot}',
      },
    },
    [`${mcpTargetPrefix}-serve`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [
          `uv run uvicorn --reload ${moduleName}.${mcpServerNameSnakeCase}.http:app --host 0.0.0.0 --port ${localDevPort}`,
        ],
        cwd: '{projectRoot}',
        env: {
          PORT: `${localDevPort}`,
        },
      },
    },
    [`${mcpTargetPrefix}-dev`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [
          `uv run uvicorn --reload ${moduleName}.${mcpServerNameSnakeCase}.http:app --host 0.0.0.0 --port ${localDevPort}`,
        ],
        cwd: '{projectRoot}',
        env: {
          PORT: `${localDevPort}`,
          LOCAL_DEV: 'true',
        },
      },
    },
    [`${mcpTargetPrefix}-inspect`]: {
      executor: 'nx:run-commands',
      continuous: true,
      // Launch the inspector against the locally served HTTP server. The dev
      // target starts the server and any connected dependencies (e.g. a local
      // database).
      dependsOn: [`${mcpTargetPrefix}-dev`],
      options: {
        commands: [
          `mcp-inspector --transport http --server-url http://localhost:${localDevPort}/mcp`,
        ],
        cwd: '{projectRoot}',
      },
    },
    [`${mcpTargetPrefix}-inspect-stdio`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [
          `mcp-inspector -- uv run -m ${moduleName}.${mcpServerNameSnakeCase}.stdio`,
        ],
        cwd: '{projectRoot}',
      },
    },
  };

  // Aggregate `<mcp>-dev` under the project-level `dev` target.
  addComponentDevTarget(mcpTargets, `${mcpTargetPrefix}-dev`);

  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: mcpTargets,
  });

  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@modelcontextprotocol/inspector']),
  );

  addComponentGeneratorMetadata(
    tree,
    project.name,
    PY_MCP_SERVER_GENERATOR_INFO,
    toProjectRelativePath(project, targetSourceDir),
    mcpTargetPrefix,
    {
      port: localDevPort,
      rc: mcpServerNameClassName,
      auth,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [PY_MCP_SERVER_GENERATOR_INFO]);

  await ensureLicenseExceptions(tree, MCP_INSPECTOR_EXCEPTIONS);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyMcpServerGenerator;
