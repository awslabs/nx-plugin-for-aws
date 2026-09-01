/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addAgentRuntimeToConnectionNamespace } from '../../../connection/agent-runtime-config.js';
import type { ResolvedConnectionOptions } from '../../../connection/generator.js';
import type { AgentGatewayRoute } from '../../../ts/agent/react-connection/generator.js';
import {
  DEPENDENCIES as AGUI_DEPENDENCIES,
  type AgUiAuth,
  addAgUiReactConnection,
  resolveAgUiTheme,
} from '../../../ts/react-website/agui/generator.js';
import {
  addOpenApiReactClient,
  OPEN_API_REACT_DEPENDENCIES,
} from '../../../utils/connection/open-api/react.js';
import {
  declareDependencies,
  onlyWhen,
} from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { kebabCase, toClassName, toSnakeCase } from '../../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { sortObjectKeys } from '../../../utils/object.js';
import { toProjectRelativePath } from '../../../utils/paths.js';
import {
  addPyAgentTargetToLocalDev,
  openApiClientLocalDevDeps,
} from './local-dev.js';

/** The metadata this generator records, which its predicates read. */
export interface PyAgentReactConnectionMetadata {
  readonly protocol: string;
  readonly auth: string;
  /** The AG-UI theme module, which the website's `ux` selects. */
  readonly theme: string;
}

/** The OpenAPI-over-HTTP path, which the AG-UI path takes none of. */
const isHttp = (m: PyAgentReactConnectionMetadata) => m.protocol !== 'ag-ui';

/** The AG-UI path, whose packages `addAgUiReactConnection` adds. */
const isAgUi = (m: PyAgentReactConnectionMetadata) => !isHttp(m);

// Each entry names the protocol path it belongs to: the HTTP path's OpenAPI
// client packages are added by `addOpenApiReactClient`, the AG-UI path's by
// `addAgUiReactConnection`, both on this generator's behalf. The AG-UI entries
// keep their own theme and auth conditions, which the metadata below records.
export const DEPENDENCIES =
  declareDependencies<PyAgentReactConnectionMetadata>()({
    ts: [
      ...onlyWhen(OPEN_API_REACT_DEPENDENCIES, isHttp),
      ...onlyWhen(AGUI_DEPENDENCIES.ts, isAgUi),
    ],
  });

export const PY_AGENT_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const pyAgentReactConnectionGenerator = async (
  tree: Tree,
  options: ResolvedConnectionOptions & { gatewayRoute?: AgentGatewayRoute },
) => {
  const frontendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const agentProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const targetComponent: ComponentMetadata | undefined =
    options.targetComponent;

  // Extract agent metadata from the target component or project metadata
  const metadata = agentProjectConfig.metadata as any;
  const agentName = targetComponent?.name ?? 'agent';
  const agentNameClassName = targetComponent?.rc ?? toClassName(agentName);
  const agentPort = targetComponent?.port ?? metadata?.ports?.[0] ?? 8081;
  // Behind a gateway the browser authenticates with the gateway, not the agent.
  const auth = (
    options.gatewayRoute?.gatewayAuth ??
    targetComponent?.auth ??
    metadata?.auth ??
    'iam'
  ).toLowerCase();
  const protocol = (targetComponent?.protocol ?? 'http').toLowerCase();

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const connectionMetadata: PyAgentReactConnectionMetadata = {
    protocol,
    auth,
    theme: resolveAgUiTheme(frontendProjectConfig),
  };

  if (protocol === 'a2a') {
    throw new Error(
      `Cannot connect a React website to an A2A agent. ` +
        `Consider generating an agent with the HTTP or AG-UI protocol instead.`,
    );
  }

  let additionalLocalDevDeps: string[] = [];

  if (protocol === 'ag-ui') {
    await addAgUiReactConnection(tree, {
      frontendProjectConfig,
      agentName,
      agentNameClassName,
      auth: auth as AgUiAuth,
      gatewayRoute: options.gatewayRoute,
    });
  } else {
    const moduleName = getModuleName(agentProjectConfig);
    const agentNameSnakeCase = toSnakeCase(agentName);
    const agentTargetPrefix = targetComponent?.name ? agentName : 'agent';

    // Add OpenAPI spec generation script scoped to this agent
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files/agent'),
      agentProjectConfig.root,
      {
        moduleName,
        agentNameSnakeCase,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );

    // Instrument the OpenAPI spec generation as a target on the agent project
    const openApiTargetName = `${agentTargetPrefix}-openapi`;
    const openApiDist = joinPathFragments(
      'dist',
      agentProjectConfig.root,
      'openapi',
      agentNameSnakeCase,
    );
    const specPath = joinPathFragments(openApiDist, 'openapi.json');

    updateProjectConfiguration(tree, agentProjectConfig.name, {
      ...agentProjectConfig,
      targets: sortObjectKeys({
        ...agentProjectConfig.targets,
        [openApiTargetName]: {
          cache: true,
          // The spec serialises models a dependency may own, and this target
          // has no `dependsOn` for `default`'s transitive
          // `dependentTasksOutputFiles` to resolve against — so `^production` is
          // the only edge to the dependency, and without it a model change there
          // serves a stale spec.
          inputs: ['production', '^production'],
          executor: 'nx:run-commands',
          outputs: [
            `{workspaceRoot}/dist/{projectRoot}/openapi/${agentNameSnakeCase}`,
          ],
          options: {
            commands: [
              `uv run python {projectRoot}/scripts/${agentNameSnakeCase}_openapi.py "dist/{projectRoot}/openapi/${agentNameSnakeCase}/openapi.json"`,
            ],
          },
        },
      }),
    });

    // Use the shared OpenAPI react client utility for hooks, providers, and build targets.
    // The dev target is handled separately below using the agent-specific dev target.
    await addOpenApiReactClient(
      tree,
      {
        apiName: agentNameClassName,
        frontendProjectConfig,
        backendProjectConfig: agentProjectConfig,
        specBuildProject: agentProjectConfig,
        specPath,
        specBuildTargetName: `${agentProjectConfig.name}:${openApiTargetName}`,
        auth,
        port: agentPort,
        isAgentRuntime: true,
        gatewayRoute: options.gatewayRoute,
        skipLocalDev: true,
      },
      DEPENDENCIES,
    );

    additionalLocalDevDeps = openApiClientLocalDevDeps(agentNameClassName);

    // HTTP only — the AG-UI branch handles this inside addAgUiReactConnection.
    // Agent constructs publish their runtime ARN to the 'agentcore' namespace
    // by default, which isn't exposed to the website; patch them to also
    // publish under 'connection' so the browser can read it. When routing via
    // a gateway, the gateway publishes its own URL instead.
    if (!options.gatewayRoute) {
      await addAgentRuntimeToConnectionNamespace(tree, {
        agentNameKebabCase: kebabCase(agentNameClassName),
        agentNameClassName,
      });
    }
  }

  if (options.gatewayRoute) {
    // The gateway react-connection wires the website's dev target to the
    // local gateway (which proxies to the agent); only the OpenAPI client
    // generation targets are still needed here.
    if (additionalLocalDevDeps.length > 0) {
      const websiteConfig = readProjectConfigurationUnqualified(
        tree,
        frontendProjectConfig.name,
      );
      if (websiteConfig.targets?.['dev']) {
        for (const additional of additionalLocalDevDeps) {
          addDependencyToTargetIfNotPresent(websiteConfig, 'dev', additional);
        }
        updateProjectConfiguration(tree, websiteConfig.name, websiteConfig);
      }
    }
  } else {
    await addPyAgentTargetToLocalDev(
      tree,
      frontendProjectConfig.name,
      agentProjectConfig.name,
      {
        agentName,
        agentNameClassName,
        port: agentPort,
        targetComponent,
        additionalDependencyTargets: additionalLocalDevDeps,
      },
    );
  }

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    frontendProjectConfig.name,
    PY_AGENT_REACT_CONNECTION_GENERATOR_INFO,
    toProjectRelativePath(
      frontendProjectConfig,
      protocol === 'ag-ui'
        ? joinPathFragments(
            frontendProjectConfig.sourceRoot,
            'hooks',
            `useAgui${agentNameClassName}`,
          )
        : joinPathFragments(
            frontendProjectConfig.sourceRoot,
            'components',
            `${agentNameClassName}Provider`,
          ),
    ),
    agentNameClassName,
    connectionMetadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

/**
 * Determine the Python module name from the project configuration
 */
const getModuleName = (
  projectConfig: ReturnType<typeof readProjectConfigurationUnqualified>,
): string => {
  if (projectConfig.sourceRoot) {
    const sourceRootParts = projectConfig.sourceRoot.split('/');
    return sourceRootParts[sourceRootParts.length - 1];
  }
  throw new Error(
    `Could not determine sourceRoot for project ${projectConfig.name}`,
  );
};

export default pyAgentReactConnectionGenerator;
