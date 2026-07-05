/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
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
import { ensureLicenseExceptions } from '../../license/config';
import { MCP_INSPECTOR_EXCEPTIONS } from '../../license/known-exceptions';
import { addMcpServerInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { addTypeScriptBundleTarget } from '../../utils/bundle/bundle';
import { resolveContainers } from '../../utils/containers';
import { formatFilesInSubtree } from '../../utils/format';
import { FsCommands } from '../../utils/fs';
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
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { TS_VERSIONS, withVersions } from '../../utils/versions';
import type { TsMcpServerGeneratorSchema } from './schema';

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

  // Generate esm if the module system is esm, otherwise commonjs. Projects
  // don't typically have their own package.json (dependencies are declared in
  // the workspace root), so fall back to the workspace format when absent.
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
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add dependencies
  const deps = withVersions([
    '@modelcontextprotocol/sdk',
    'zod',
    'express',
    '@aws-lambda-powertools/parameters',
    '@aws-sdk/client-appconfigdata',
  ]);
  const devDeps = withVersions([
    'tsx',
    '@types/express',
    '@modelcontextprotocol/inspector',
  ]);

  // Add hosting based on infra
  if (infra === 'agentcore') {
    const containers = await resolveContainers(tree, 'inherit');
    const dockerImageTag = `${getNpmScope(tree)}-${name}:latest`;

    // Add bundle target
    await addTypeScriptBundleTarget(tree, project, {
      targetFilePath: `${targetSourceDirRelativeToProjectRoot}/http.ts`,
      bundleOutputDir: joinPathFragments('mcp', name),
    });

    const dockerOutputDir = joinPathFragments(
      'dist',
      project.root,
      'bundle',
      'mcp',
      name,
    );
    const dockerTargetName = `${mcpTargetPrefix}-docker`;

    const fs = new FsCommands(tree);
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
  } else {
    // No Dockerfile needed for non-hosted MCP
    tree.delete(joinPathFragments(targetSourceDir, 'Dockerfile'));
  }

  addDependenciesToPackageJson(tree, deps, devDeps);
  // Add to the project's package.json too if it has one (e.g. nx plugins),
  // otherwise dependencies live in the workspace root only.
  if (tree.exists(projectPackageJsonPath)) {
    addDependenciesToPackageJson(tree, deps, devDeps, projectPackageJsonPath);
  }

  // @modelcontextprotocol/sdk declares zod as a peer dependency with a wide range
  // (^3.25 || ^4.0). Yarn does not dedupe the peer to the workspace's pinned zod, so
  // without a resolution it installs a separate zod under the SDK's own node_modules.
  // The two zod copies have structurally incompatible types, which breaks type
  // inference for registerTool inputSchema. Scope the resolution to the SDK so
  // other consumers (e.g. @tanstack/router-generator pinning zod@3) are unaffected.
  if (detectPackageManager() === 'yarn') {
    updateJson(tree, 'package.json', (packageJson) => {
      packageJson.resolutions = {
        ...packageJson.resolutions,
        '**/@modelcontextprotocol/sdk/zod': TS_VERSIONS['zod'],
      };
      return packageJson;
    });
  }

  const localDevPort = assignPort(tree, project, 8000, {
    component: { info: TS_MCP_SERVER_GENERATOR_INFO, name: mcpTargetPrefix },
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
    {
      port: localDevPort,
      rc: mcpServerNameClassName,
      auth,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_MCP_SERVER_GENERATOR_INFO]);

  await ensureLicenseExceptions(tree, MCP_INSPECTOR_EXCEPTIONS);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsMcpServerGenerator;
