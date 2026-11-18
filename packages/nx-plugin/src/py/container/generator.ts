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
import { addPyDependencies } from '../../utils/add-dependencies.js';
import { addPythonBundleTarget } from '../../utils/bundle/bundle.js';
import {
  addContainerServiceInfra,
  CONTAINER_PORT,
  containerHealthCheckCommand,
} from '../../utils/container-constructs/container-constructs.js';
import type { ContainerMetadata } from '../../utils/container-constructs/container-metadata.js';
import { resolveContainers } from '../../utils/containers.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies.js';
import {
  addDockerScanTarget,
  DOCKER_DEPENDENCIES,
  IMAGE_BUILD_CACHE,
} from '../../utils/docker.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { kebabCase, toClassName, toSnakeCase } from '../../utils/names.js';
import { getNpmScope } from '../../utils/npm-scope.js';
import {
  addArtifactDependencyToTargets,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  normalizeTargetKeyOrder,
  readProjectConfigurationUnqualified,
  updateComponentGeneratorMetadata,
} from '../../utils/nx.js';
import { assertSupportedNxVersion } from '../../utils/nx-version.js';
import { sortObjectKeys } from '../../utils/object.js';
import { toProjectRelativePath } from '../../utils/paths.js';
import { assignPort } from '../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import type { IacMetadata } from '../../utils/shared-constructs-constants.js';
import { BASE_IMAGES } from '../../utils/versions.js';
import type { PyContainerGeneratorSchema } from './schema';

/**
 * The metadata this generator records, which its predicates read. `IacMetadata`
 * is named again so owned-dependencies.spec.ts, which resolves extended
 * interfaces only from shared-constructs-constants.ts, sees `iac`.
 */
export interface PyContainerMetadata extends ContainerMetadata, IacMetadata {}

export const DEPENDENCIES = declareDependencies<PyContainerMetadata>()({
  ts: [
    // Added by the helpers that own the projects they belong to.
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: [{ name: 'fastapi' }, { name: 'uvicorn' }],
});

export const PY_CONTAINER_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Adds a containerised HTTP service (FastAPI on uvicorn) to a Python project:
 * the server, a Dockerfile, the serve, bundle, docker and trivy targets, and
 * with `infra=ecs` the ECS service infrastructure. Records the component
 * metadata the connection generators read.
 */
export const pyContainerGenerator = async (
  tree: Tree,
  options: PyContainerGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Refuse an older Nx major before any file is written.
  assertSupportedNxVersion(tree);
  const project = readProjectConfigurationUnqualified(tree, options.project);

  if (!tree.exists(joinPathFragments(project.root, 'pyproject.toml'))) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a Python project (with a pyproject.toml)`,
    );
  }

  if (!project.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  // Same naming as py#agent: an unnamed service is `<project>-service` for
  // resource and class names, and `service` for targets; the source folder is
  // the snake_case name inside the project's module.
  const name = kebabCase(
    options.name || `${kebabCase(project.name.split('.').pop())}-service`,
  );
  const targetPrefix = options.name ? name : 'service';
  const nameClassName = toClassName(name);
  const nameSnakeCase = toSnakeCase(options.name || 'service');
  const sourceDir = joinPathFragments(project.sourceRoot, nameSnakeCase);
  const moduleName = project.sourceRoot.split('/').pop();

  const infra = options.infra ?? 'ecs';
  const iac = infra === 'ecs' ? await resolveIac(tree, options.iac) : undefined;

  const port = assignPort(tree, project, 8081, {
    component: { info: PY_CONTAINER_GENERATOR_INFO, name: targetPrefix },
  });

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'app'),
    sourceDir,
    { nameClassName },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'deploy'),
    sourceDir,
    {
      pythonBaseImage: BASE_IMAGES.python,
      moduleName,
      nameSnakeCase,
      containerPort: CONTAINER_PORT,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  const { bundleTargetName, bundleOutputDir } = addPythonBundleTarget(project, {
    pythonPlatform: 'aarch64-manylinux_2_28',
  });

  const containers = await resolveContainers(tree, 'inherit');
  const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;
  const dockerBuildContextDir = joinPathFragments(
    'dist',
    project.root,
    'docker',
    name,
  );
  const dockerTargetName = `${targetPrefix}-docker`;
  const fs = new FsCommands(tree, DEPENDENCIES);
  // In Nx's key order, so a re-run writes the same project.json.
  project.targets[dockerTargetName] = normalizeTargetKeyOrder({
    cache: IMAGE_BUILD_CACHE,
    executor: 'nx:run-commands',
    options: {
      commands: [
        fs.rm(dockerBuildContextDir),
        fs.mkdir(dockerBuildContextDir),
        fs.cpDir(bundleOutputDir, dockerBuildContextDir),
        fs.cpFile(
          `${sourceDir}/Dockerfile`,
          `${dockerBuildContextDir}/Dockerfile`,
        ),
        fs.cpFile(
          `${sourceDir}/.dockerignore`,
          `${dockerBuildContextDir}/.dockerignore`,
        ),
        `${containers} build --platform linux/arm64 -t ${dockerImageTag} ${dockerBuildContextDir}`,
      ],
      parallel: false,
    },
    dependsOn: [bundleTargetName],
  });
  addDependencyToTargetIfNotPresent(project, 'docker', dockerTargetName);
  addArtifactDependencyToTargets(project, 'docker');

  addDockerScanTarget(
    tree,
    {
      project,
      containerEngine: containers,
      trivyTargetName: `${targetPrefix}-trivy`,
      dockerTargetName,
      imageTags: [dockerImageTag],
    },
    DEPENDENCIES,
  );

  // No --reload: the reloader's supervisor keeps the port after SIGTERM.
  project.targets[`${targetPrefix}-serve`] = {
    executor: 'nx:run-commands',
    continuous: true,
    options: {
      commands: [`uv run python -m ${moduleName}.${nameSnakeCase}.main`],
      cwd: '{projectRoot}',
      // The clients a connection vends read LOCAL_DEV to use the local
      // database a connection's dev dependency starts.
      env: { PORT: `${port}`, LOCAL_DEV: 'true' },
    },
  };

  // Written before the metadata calls, which re-read the project, so the port
  // assignPort reserved in metadata.ports is kept.
  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: sortObjectKeys(project.targets),
  });

  if (infra === 'ecs') {
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);
    await addContainerServiceInfra(tree, {
      nameClassName,
      nameKebabCase: name,
      projectName: project.name,
      dockerImageTag,
      dockerBuildContextDir,
      containerPort: CONTAINER_PORT,
      healthCheckCommand: containerHealthCheckCommand('python'),
      containers,
      iac,
    });
  }

  const metadata: PyContainerMetadata = {
    infra,
    port,
    rc: nameClassName,
    ...(iac ? { iac } : {}),
  };

  addPyDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: project.root,
  });

  addComponentGeneratorMetadata(
    tree,
    project.name,
    PY_CONTAINER_GENERATOR_INFO,
    toProjectRelativePath(project, sourceDir),
    targetPrefix,
    metadata,
  );
  // Converges the values a re-run with different options resolved.
  updateComponentGeneratorMetadata(
    tree,
    project.name,
    PY_CONTAINER_GENERATOR_INFO,
    targetPrefix,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [PY_CONTAINER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyContainerGenerator;
