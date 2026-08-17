/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  detectPackageManager,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  readJson,
  type Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addTsDependencies } from '../../utils/add-dependencies';
import {
  AGENT_CORE_CONSTRUCTS_PY_DEPENDENCIES,
  addMcpServerInfra,
} from '../../utils/agent-core-constructs/agent-core-constructs';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies';
import {
  ADOT_IMAGE_DEPENDENCIES,
  addDockerScanTarget,
  DOCKER_DEPENDENCIES,
  NODE_IMAGE_DEPENDENCIES,
  nodeImageVersions,
} from '../../utils/docker';
import { formatFilesInSubtree } from '../../utils/format';
import { FS_DEPENDENCIES, FsCommands } from '../../utils/fs';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { isEsmWorkspace } from '../../utils/module-format';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScope } from '../../utils/npm-scope';
import {
  addComponentDevTarget,
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sortObjectKeys } from '../../utils/object';
import { assignPort } from '../../utils/port';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import type { IacMetadata } from '../../utils/shared-constructs-constants';
import { BASE_IMAGES, TS_VERSIONS } from '../../utils/versions';
import type { TsMcpServerGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TsMcpServerMetadata extends IacMetadata {
  readonly port: number;
  readonly rc: string;
  readonly auth: string;
}

export const DEPENDENCIES = declareDependencies<TsMcpServerMetadata>()({
  ts: [
    { name: '@modelcontextprotocol/sdk' },
    { name: 'zod' },
    { name: 'express' },
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@aws-sdk/client-appconfigdata' },
    { name: '@types/express', dev: true },
    // tsx (local dev) and the MCP inspector are shared tooling.
    { name: 'tsx', dev: true, root: true },
    { name: '@modelcontextprotocol/inspector', dev: true, root: true },
    ...ownedElsewhere(FS_DEPENDENCIES),
    ...ownedElsewhere(BUNDLE_DEPENDENCIES),
    ...ownedElsewhere(DOCKER_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(NODE_IMAGE_DEPENDENCIES),
    ...ownedElsewhere(ADOT_IMAGE_DEPENDENCIES),
  ],
  py: ownedElsewhere(AGENT_CORE_CONSTRUCTS_PY_DEPENDENCIES),
});

export const TS_MCP_SERVER_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

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
  const name = kebabCase(options.name || defaultName);
  const mcpServerNameClassName = toClassName(name);
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

  const projectPackageJsonPath = joinPathFragments(
    project.root,
    'package.json',
  );

  // Generate esm if the project's package.json is `type: module`, falling
  // back to the workspace format when the project has no manifest.
  const esm = tree.exists(projectPackageJsonPath)
    ? readJson(tree, projectPackageJsonPath).type === 'module'
    : isEsmWorkspace(tree);

  // Generate example server
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    targetSourceDir,
    {
      name,
      esm,
      distDir,
      adotVersion:
        TS_VERSIONS['@aws/aws-distro-opentelemetry-node-autoinstrumentation'],
      jaegerVersion: TS_VERSIONS['@opentelemetry/propagator-jaeger'],
      nodeBaseImage: BASE_IMAGES.node,
      ...nodeImageVersions(),
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add hosting based on infra
  if (infra === 'agentcore') {
    const containers = await resolveContainers(tree, 'inherit');
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    await addTypeScriptBundleTarget(
      tree,
      project,
      {
        targetFilePath: `${targetSourceDirRelativeToProjectRoot}/http.ts`,
        bundleOutputDir: joinPathFragments('mcp', name),
      },
      DEPENDENCIES,
    );

    const dockerOutputDir = joinPathFragments(
      'dist',
      project.root,
      'bundle',
      'mcp',
      name,
    );
    const dockerTargetName = `${mcpTargetPrefix}-docker`;

    const fs = new FsCommands(tree, DEPENDENCIES);
    project.targets[dockerTargetName] = {
      cache: true,
      outputs: [`{workspaceRoot}/${dockerOutputDir}/Dockerfile`],
      executor: 'nx:run-commands',
      options: {
        commands: [
          fs.cp(
            `${targetSourceDir}/Dockerfile`,
            `${dockerOutputDir}/Dockerfile`,
          ),
          `${containers} build --platform linux/arm64 -t ${dockerImageTag} ${dockerOutputDir}`,
        ],
        parallel: false,
      },
      dependsOn: ['bundle'],
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
  } else {
    // No Dockerfile needed for non-hosted MCP
    tree.delete(joinPathFragments(targetSourceDir, 'Dockerfile'));
  }

  // @modelcontextprotocol/sdk declares zod as a peer dependency with a wide range
  // (^3.25 || ^4.0). Yarn does not dedupe the peer to the workspace's pinned zod, so
  // without a resolution it installs a separate zod under the SDK's own node_modules.
  // The two zod copies have structurally incompatible types, which breaks type
  // inference for registerTool inputSchema. Scope the resolution to the SDK so
  // other consumers (e.g. @tanstack/router-generator pinning zod@3) are unaffected.
  // Classic yarn only honours the `**/`-prefixed descriptor in a workspace, and
  // berry only the bare one — it deletes a glob descriptor on install — so
  // declare both.
  if (detectPackageManager() === 'yarn') {
    updateJson(tree, 'package.json', (packageJson) => {
      packageJson.resolutions = {
        ...packageJson.resolutions,
        '**/@modelcontextprotocol/sdk/zod': TS_VERSIONS['zod'],
        '@modelcontextprotocol/sdk/zod': TS_VERSIONS['zod'],
      };
      return packageJson;
    });
  }

  const localDevPort = assignPort(tree, project, 8000, {
    component: { info: TS_MCP_SERVER_GENERATOR_INFO, name: mcpTargetPrefix },
  });

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const metadata: TsMcpServerMetadata = {
    port: localDevPort,
    rc: mcpServerNameClassName,
    auth,
    ...(iac ? { iac } : {}),
  };

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: project.root,
  });

  const mcpTargets = {
    ...project.targets,
    // Add targets for running the MCP server
    [`${mcpTargetPrefix}-serve-stdio`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [`tsx --watch ${relativeSourceDir}/stdio.ts`],
        cwd: '{projectRoot}',
      },
    },
    [`${mcpTargetPrefix}-serve`]: {
      executor: 'nx:run-commands',
      continuous: true,
      options: {
        commands: [`tsx --watch ${relativeSourceDir}/http.ts`],
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
        commands: [`tsx --watch ${relativeSourceDir}/http.ts`],
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
          `mcp-inspector -- tsx --watch ${relativeSourceDir}/stdio.ts`,
        ],
        cwd: '{projectRoot}',
      },
    },
  };

  // Aggregate `<mcp>-dev` under the project-level `dev` target.
  addComponentDevTarget(mcpTargets, `${mcpTargetPrefix}-dev`);

  updateProjectConfiguration(tree, project.name, {
    ...project,
    // Sort targets so their order is stable regardless of insertion order on
    // first run vs re-run.
    targets: sortObjectKeys(mcpTargets),
  });

  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_MCP_SERVER_GENERATOR_INFO,
    targetSourceDirRelativeToProjectRoot,
    mcpTargetPrefix,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_MCP_SERVER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsMcpServerGenerator;
