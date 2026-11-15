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
import { addTsDependencies } from '../../utils/add-dependencies.js';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../utils/bundle/bundle.js';
import {
  addContainerServiceInfra,
  CONTAINER_PORT,
} from '../../utils/container-constructs/container-constructs.js';
import type { ContainerMetadata } from '../../utils/container-constructs/container-metadata.js';
import { resolveContainerOptions } from '../../utils/container-constructs/container-metadata.js';
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
import { esmVars } from '../../utils/module-format.js';
import { kebabCase, toClassName } from '../../utils/names.js';
import { getNpmScope } from '../../utils/npm-scope.js';
import {
  addArtifactDependencyToTargets,
  addComponentDevTarget,
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
import { assignPort } from '../../utils/port.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import {
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../utils/shared-constructs-constants.js';
import { BASE_IMAGES } from '../../utils/versions.js';
import type { TsContainerGeneratorSchema } from './schema';

/**
 * The metadata this generator records, which its predicates read.
 *
 * `IacMetadata` is already part of `ContainerMetadata`; naming it here lets the
 * declaration coverage check in `owned-dependencies.spec.ts` see `iac`.
 */
export interface TsContainerMetadata extends ContainerMetadata, IacMetadata {}

export const DEPENDENCIES = declareDependencies<TsContainerMetadata>()({
  ts: [
    { name: '@types/node', dev: true },
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(BUNDLE_DEPENDENCIES),
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
});

export const TS_CONTAINER_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Adds a containerised HTTP service to a TypeScript project: a `node:http`
 * server, a Dockerfile, bundle, image build, image scan and serve targets,
 * and, with `infra=ecs`, the ECS service infrastructure.
 */
export const tsContainerGenerator = async (
  tree: Tree,
  options: TsContainerGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Refuse an older Nx major before any file is written.
  assertSupportedNxVersion(tree);
  const project = readProjectConfigurationUnqualified(tree, options.project);

  if (!tree.exists(joinPathFragments(project.root, 'tsconfig.json'))) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a TypeScript project (with a tsconfig.json)`,
    );
  }

  // Same naming as ts#agent: an unnamed service is `<project>-service` for
  // resource and class names, and `service` for targets and the source folder.
  const name = kebabCase(
    options.name || `${kebabCase(project.name.split('/').pop())}-service`,
  );
  const targetPrefix = options.name ? name : 'service';
  const nameClassName = toClassName(name);
  const sourceDirRelativeToProjectRoot = joinPathFragments('src', targetPrefix);
  const sourceDir = joinPathFragments(
    project.root,
    sourceDirRelativeToProjectRoot,
  );

  const resolved = resolveContainerOptions(options);
  const iac =
    resolved.infra === 'ecs' ? await resolveIac(tree, options.iac) : undefined;

  const port = assignPort(tree, project, 8081, {
    component: { info: TS_CONTAINER_GENERATOR_INFO, name: targetPrefix },
  });

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'app'),
    sourceDir,
    esmVars(tree),
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'deploy'),
    sourceDir,
    { nodeBaseImage: BASE_IMAGES.node },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  const containers = await resolveContainers(tree, 'inherit');
  const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

  await addTypeScriptBundleTarget(
    tree,
    project,
    {
      targetFilePath: `${sourceDirRelativeToProjectRoot}/index.ts`,
      bundleOutputDir: joinPathFragments('container', name),
    },
    DEPENDENCIES,
  );
  const bundleOutputDir = joinPathFragments(
    'dist',
    project.root,
    'bundle',
    'container',
    name,
  );

  const dockerTargetName = `${targetPrefix}-docker`;
  const fs = new FsCommands(tree, DEPENDENCIES);
  project.targets[dockerTargetName] = normalizeTargetKeyOrder({
    cache: IMAGE_BUILD_CACHE,
    executor: 'nx:run-commands',
    options: {
      commands: [
        fs.cpFile(`${sourceDir}/Dockerfile`, `${bundleOutputDir}/Dockerfile`),
        fs.cpFile(
          `${sourceDir}/.dockerignore`,
          `${bundleOutputDir}/.dockerignore`,
        ),
        `${containers} build --platform linux/arm64 -t ${dockerImageTag} ${bundleOutputDir}`,
      ],
      parallel: false,
    },
    dependsOn: ['bundle'],
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

  if (resolved.infra === 'ecs' && iac) {
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);
    await addContainerServiceInfra(tree, {
      nameClassName,
      nameKebabCase: name,
      projectName: project.name,
      dockerImageTag,
      dockerBuildContextDir: bundleOutputDir,
      containerPort: CONTAINER_PORT,
      ingress: resolved.ingress ?? 'http-api',
      // Read only with http-api; private ingress has no auth.
      auth: resolved.auth ?? 'none',
      containers,
      iac,
    });
  }

  const targets = {
    ...project.targets,
    [`${targetPrefix}-serve`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [`tsx --watch ./${sourceDirRelativeToProjectRoot}/index.ts`],
        cwd: '{projectRoot}',
        env: {
          PORT: `${port}`,
        },
      },
    },
  };
  addComponentDevTarget(targets, `${targetPrefix}-serve`);

  updateProjectConfiguration(tree, project.name, {
    ...project,
    // Sorted so the order is the same on a first run and a re-run.
    targets: sortObjectKeys(targets),
  });

  const metadata: TsContainerMetadata = {
    infra: resolved.infra,
    ...(resolved.ingress ? { ingress: resolved.ingress } : {}),
    ...(resolved.auth ? { auth: resolved.auth } : {}),
    port,
    rc: nameClassName,
    ...(iac ? { iac } : {}),
  };

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: project.root,
  });

  const recorded = recordedMetadata(tree, project.name, targetPrefix);
  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_CONTAINER_GENERATOR_INFO,
    sourceDirRelativeToProjectRoot,
    targetPrefix,
    metadata,
  );
  if (recorded?.infra === 'none' && resolved.infra === 'ecs') {
    // Escalating from infra=none: record what the infrastructure was built with.
    updateComponentGeneratorMetadata(
      tree,
      project.name,
      TS_CONTAINER_GENERATOR_INFO,
      targetPrefix,
      {
        infra: metadata.infra,
        ingress: metadata.ingress,
        ...(metadata.auth ? { auth: metadata.auth } : {}),
        iac: metadata.iac,
      },
    );
  } else if (
    recorded?.infra === 'ecs' &&
    resolved.infra === 'ecs' &&
    (recorded.ingress !== resolved.ingress || recorded.auth !== resolved.auth)
  ) {
    console.warn(
      `Warning: ${targetPrefix} was generated with ingress ${recorded.ingress}${recorded.auth ? ` and auth ${recorded.auth}` : ''}. ` +
        `Re-running does not change it; edit ${serviceInfraPath(recorded.iac, name)} instead`,
    );
  }

  await addGeneratorMetricsIfApplicable(tree, [TS_CONTAINER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

/** The user-owned file that sets a service's ingress and auth. */
const serviceInfraPath = (iac: string | undefined, name: string) =>
  iac === 'terraform'
    ? joinPathFragments(
        PACKAGES_DIR,
        SHARED_TERRAFORM_DIR,
        'src',
        'app',
        'services',
        name,
        `${name}.tf`,
      )
    : joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'app',
        'services',
        `${name}.ts`,
      );

/** The metadata a previous run recorded for this component, if any. */
const recordedMetadata = (
  tree: Tree,
  projectName: string,
  componentName: string,
): ContainerMetadata | undefined =>
  (
    readProjectConfigurationUnqualified(tree, projectName).metadata as
      | {
          components?: (ContainerMetadata & {
            generator: string;
            name?: string;
          })[];
        }
      | undefined
  )?.components?.find(
    (c) =>
      c.generator === TS_CONTAINER_GENERATOR_INFO.id &&
      c.name === componentName,
  );

export default tsContainerGenerator;
