/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  addPyDependencies,
  addTsDependencies,
} from '../../utils/add-dependencies.js';
import { addMcpServerInfra } from '../../utils/agent-core-constructs/agent-core-constructs.js';
import { addPythonBundleTarget } from '../../utils/bundle/bundle.js';
import { resolveContainers } from '../../utils/containers.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import {
  addDockerScanTarget,
  DOCKER_DEPENDENCIES,
} from '../../utils/docker.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { kebabCase, toClassName, toSnakeCase } from '../../utils/names.js';
import { getNpmScope } from '../../utils/npm-scope.js';
import {
  addComponentDevTarget,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { toProjectRelativePath } from '../../utils/paths.js';
import { registerPnpmBuiltDependencies } from '../../utils/pnpm-workspace.js';
import { assignPort } from '../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import type { IacMetadata } from '../../utils/shared-constructs-constants.js';
import { BASE_IMAGES } from '../../utils/versions.js';
import type { PyMcpServerGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface PyMcpServerMetadata extends IacMetadata {
  readonly port: number;
  readonly rc: string;
  readonly auth: string;
}

export const DEPENDENCIES = declareDependencies<PyMcpServerMetadata>()({
  ts: [
    // The MCP inspector is shared tooling.
    { name: '@modelcontextprotocol/inspector', dev: true, root: true },
    // Added by the helpers that own the projects they belong to.
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: [
    { name: 'aws-lambda-powertools' },
    { name: 'mcp' },
    { name: 'uvicorn' },
    { name: 'boto3' },
    { name: 'aws-opentelemetry-distro' },
  ],
});

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

  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

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
        pythonBaseImage: BASE_IMAGES.python,
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
    const fs = new FsCommands(tree, DEPENDENCIES);
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
        ],
        parallel: false,
      },
      dependsOn: [bundleTargetName],
    };

    addDependencyToTargetIfNotPresent(project, 'docker', dockerTargetName);
    addDependencyToTargetIfNotPresent(project, 'build', 'docker');

    addDockerScanTarget(
      tree,
      {
        project,
        containerEngine: containers,
        trivyTargetName: `${mcpTargetPrefix}-trivy`,
        dockerTargetName,
        imageTags: [dockerImageTag],
      },
      DEPENDENCIES,
    );

    // Add shared constructs
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);

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

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const metadata: PyMcpServerMetadata = {
    port: localDevPort,
    rc: mcpServerNameClassName,
    auth,
    ...(iac ? { iac } : {}),
  };

  // The MCP inspector has a postinstall script that cascades installs into its
  // client packages, which no-ops when the package is installed as a dependency.
  // Register it as an explicitly-rejected build so pnpm 11's default
  // `strictDepBuilds=true` skips it instead of failing the install.
  registerPnpmBuiltDependencies(tree, {
    '@modelcontextprotocol/inspector': false,
  });

  addPyDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: project.root,
  });
  addTsDependencies(tree, DEPENDENCIES, { metadata });

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

  addComponentGeneratorMetadata(
    tree,
    project.name,
    PY_MCP_SERVER_GENERATOR_INFO,
    toProjectRelativePath(project, targetSourceDir),
    mcpTargetPrefix,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [PY_MCP_SERVER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyMcpServerGenerator;
