/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { addAgentRuntimeToConnectionNamespace } from '../../../connection/agent-runtime-config';
import type { ResolvedConnectionOptions } from '../../../connection/generator';
import { addTsDependencies } from '../../../utils/add-dependencies';
import { addSingleImport, applyGritQL } from '../../../utils/ast';
import {
  declareDependencies,
  onlyWhen,
  ownedElsewhere,
} from '../../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../../utils/format';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { kebabCase, toClassName } from '../../../utils/names';
import {
  addComponentGeneratorMetadata,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { toProjectRelativePath } from '../../../utils/paths';
import {
  DEPENDENCIES as AGUI_DEPENDENCIES,
  type AgUiAuth,
  addAgUiReactConnection,
  resolveAgUiTheme,
} from '../../react-website/agui/generator';
import { runtimeConfigGenerator } from '../../react-website/runtime-config/generator';
import { addTsAgentTargetToLocalDev } from './local-dev';

/** The metadata this generator records, which its predicates read. */
export interface TsAgentReactConnectionMetadata {
  readonly auth: string;
  readonly protocol: string;
  /** The AG-UI theme module, which the website's `ux` selects. */
  readonly theme: string;
}

/** The tRPC-over-HTTP path, which the AG-UI path takes none of. */
const isHttp = (m: TsAgentReactConnectionMetadata) => m.protocol !== 'ag-ui';

/** The AG-UI path, whose packages `addAgUiReactConnection` adds. */
const isAgUi = (m: TsAgentReactConnectionMetadata) => !isHttp(m);

// Each entry names the protocol path it belongs to: the HTTP path's client and
// auth packages are added here, the AG-UI path's by `addAgUiReactConnection` on
// this generator's behalf.
export const DEPENDENCIES =
  declareDependencies<TsAgentReactConnectionMetadata>()({
    ts: [
      { name: '@trpc/client', when: isHttp },
      { name: '@tanstack/react-query', when: isHttp },
      { name: '@tanstack/react-query-devtools', when: isHttp },
      { name: '@trpc/tanstack-react-query', when: isHttp },
      { name: 'oidc-client-ts', when: (m) => isHttp(m) && m.auth === 'iam' },
      { name: 'aws4fetch', when: (m) => isHttp(m) && m.auth === 'iam' },
      {
        name: '@aws-sdk/credential-provider-cognito-identity',
        when: (m) => isHttp(m) && m.auth === 'iam',
      },
      {
        name: 'react-oidc-context',
        when: (m) => isHttp(m) && (m.auth === 'iam' || m.auth === 'cognito'),
      },
      { name: '@smithy/types', when: isHttp, dev: true },
      // `addAgUiReactConnection` adds these itself, so they are declared for
      // ownership only. Gated on the AG-UI path, and within it on each entry's
      // own theme or auth condition, which the metadata below records.
      ...ownedElsewhere(onlyWhen(AGUI_DEPENDENCIES.ts, isAgUi)),
    ],
  });

export const TS_AGENT_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Options for routing the website's requests to the agent through an
 * AgentCore Gateway rather than invoking the runtime directly. The gateway
 * react-connection generator dispatches here once per fronted agent.
 */
export interface AgentGatewayRoute {
  /** The gateway's class name, keying its URL in runtime config. */
  gatewayClassName: string;
  /** The agent's gateway target name, forming its path on the gateway. */
  targetName: string;
  /** The gateway's inbound auth, which is what the browser authenticates with. */
  gatewayAuth: string;
}

export async function tsAgentReactConnectionGenerator(
  tree: Tree,
  options: ResolvedConnectionOptions & { gatewayRoute?: AgentGatewayRoute },
) {
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
  const agentProjectAlias = agentProjectConfig.name;
  const agentPath = targetComponent?.path ?? 'src/agent';

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const connectionMetadata: TsAgentReactConnectionMetadata = {
    auth,
    protocol: targetComponent?.protocol ?? 'http',
    theme: resolveAgUiTheme(frontendProjectConfig),
  };

  if ((targetComponent?.protocol ?? '').toLowerCase() === 'a2a') {
    throw new Error(
      `Cannot connect a React website to an A2A agent. ` +
        `Consider generating an agent with the HTTP or AG-UI protocol instead.`,
    );
  }

  // A TypeScript HTTP agent serves tRPC over WebSocket, which AgentCore
  // Gateway does not support, so only AG-UI agents can be reached via a
  // gateway route.
  if (options.gatewayRoute && targetComponent?.protocol !== 'ag-ui') {
    throw new Error(
      `Cannot connect a React website to agent '${agentName}' via a gateway: a TypeScript HTTP agent serves tRPC over WebSocket, which AgentCore Gateway does not support. Consider the ag-ui protocol instead.`,
    );
  }

  if (targetComponent?.protocol === 'ag-ui') {
    await addAgUiReactConnection(tree, {
      frontendProjectConfig,
      agentName,
      agentNameClassName,
      auth: auth as AgUiAuth,
      gatewayRoute: options.gatewayRoute,
    });

    // When routing via a gateway, the gateway react-connection wires the
    // website's dev target to the local gateway (which proxies to the agent)
    // instead of to the agent directly.
    if (!options.gatewayRoute) {
      await addTsAgentTargetToLocalDev(
        tree,
        frontendProjectConfig.name,
        agentProjectConfig.name,
        {
          agentName,
          agentNameClassName,
          port: agentPort,
          targetComponent,
        },
      );
    }

    // Recorded so the version sync knows this connection's dependencies are ours.
    addComponentGeneratorMetadata(
      tree,
      frontendProjectConfig.name,
      TS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
      toProjectRelativePath(
        frontendProjectConfig,
        joinPathFragments(
          frontendProjectConfig.sourceRoot,
          'hooks',
          `useAgui${agentNameClassName}`,
        ),
      ),
      agentNameClassName,
      connectionMetadata,
    );

    await addGeneratorMetricsIfApplicable(tree, [
      TS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
    ]);

    await formatFilesInSubtree(tree);
    return () =>
      installDependencies(tree, options.preferInstallDependencies, {
        languages: ['typescript'],
      });
  }

  // Ensure the agent project has a wildcard path entry in tsconfig.base.json
  // so that deep imports (e.g., for the router type) resolve correctly
  ensureWildcardPathEntry(
    tree,
    agentProjectConfig.name,
    agentProjectConfig.root,
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    frontendProjectConfig.root,
    {
      agentName,
      agentNameClassName,
      auth,
      agentProjectAlias,
      agentPath,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate the tanstack query provider if it does not exist already
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      '../../../utils/files/website/components/tanstack-query',
    ),
    joinPathFragments(frontendProjectConfig.sourceRoot, 'components'),
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  if (auth === 'iam') {
    generateFiles(
      tree,
      joinPathFragments(
        import.meta.dirname,
        '../../../utils/files/website/hooks/sigv4',
      ),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'hooks'),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }

  await runtimeConfigGenerator(tree, {
    project: frontendProjectConfig.name,
    preferInstallDependencies: false,
  });

  // update main.tsx
  const mainTsxPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'main.tsx',
  );
  await addSingleImport(
    tree,
    mainTsxPath,
    'QueryClientProvider',
    './components/QueryClientProvider',
  );

  const clientProviderName = `${agentNameClassName}AgentClientProvider`;
  await addSingleImport(
    tree,
    mainTsxPath,
    clientProviderName,
    `./components/${clientProviderName}`,
  );

  // Wrap <App /> in QueryClientProvider if not already present
  await applyGritQL(
    tree,
    mainTsxPath,
    '`<App />` => `<QueryClientProvider><App /></QueryClientProvider>` where { $program <: not contains `<QueryClientProvider>$_</QueryClientProvider>` }',
  );

  // Wrap <App /> in the agent client provider if not already present
  await applyGritQL(
    tree,
    mainTsxPath,
    `\`<App />\` => \`<${clientProviderName}><App /></${clientProviderName}>\` where { $program <: not contains \`<${clientProviderName}>$_</${clientProviderName}>\` }`,
  );

  await addTsAgentTargetToLocalDev(
    tree,
    frontendProjectConfig.name,
    agentProjectConfig.name,
    {
      agentName,
      agentNameClassName,
      port: agentPort,
      targetComponent,
    },
  );

  // Expose the agent's runtime ARN to the frontend via the 'connection'
  // namespace (which is published to runtime-config.json). The agent construct
  // itself only registers to the 'agentcore' namespace by default.
  await addAgentRuntimeToConnectionNamespace(tree, {
    agentNameKebabCase: kebabCase(agentNameClassName),
    agentNameClassName,
  });

  addTsDependencies(tree, DEPENDENCIES, {
    metadata: connectionMetadata,
    projectRoot: frontendProjectConfig.root,
  });

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    frontendProjectConfig.name,
    TS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
    toProjectRelativePath(
      frontendProjectConfig,
      joinPathFragments(
        frontendProjectConfig.sourceRoot,
        'components',
        clientProviderName,
      ),
    ),
    agentNameClassName,
    connectionMetadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
}
export default tsAgentReactConnectionGenerator;

/**
 * Ensures a wildcard path entry exists in tsconfig.base.json for the given project,
 * allowing deep imports (e.g., `@scope/project/src/agent/router.js`).
 */
function ensureWildcardPathEntry(
  tree: Tree,
  projectName: string,
  projectRoot: string,
) {
  const tsconfigPath = ['tsconfig.base.json', 'tsconfig.json'].find((p) =>
    tree.exists(p),
  );
  if (!tsconfigPath) return;

  updateJson(tree, tsconfigPath, (json) => {
    const paths = json.compilerOptions?.paths ?? {};
    const wildcardKey = `${projectName}/*`;
    if (!paths[wildcardKey]) {
      paths[wildcardKey] = [`./${projectRoot}/*`];
    }
    json.compilerOptions = {
      ...json.compilerOptions,
      paths,
    };
    return json;
  });
}
