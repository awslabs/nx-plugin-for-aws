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
import { declareDependencies } from '../../../utils/declared-dependencies';
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
} from '../../react-website/agui/generator';
import { runtimeConfigGenerator } from '../../react-website/runtime-config/generator';
import { addTsAgentTargetToLocalDev } from './local-dev';

/** The metadata this generator records, which its predicates read. */
export interface TsAgentReactConnectionMetadata {
  readonly auth: string;
  readonly protocol: string;
}

/** The tRPC-over-HTTP path, which the AG-UI path takes none of. */
const isHttp = (m: TsAgentReactConnectionMetadata) => m.protocol !== 'ag-ui';

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
      // The AG-UI generator owns its whole union: it records no theme or auth, so
      // only the path is predicated here.
      ...AGUI_DEPENDENCIES.ts.map((entry) => ({
        ...entry,
        when: (m: TsAgentReactConnectionMetadata) => !isHttp(m),
      })),
    ],
  });

export const TS_AGENT_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export async function tsAgentReactConnectionGenerator(
  tree: Tree,
  options: ResolvedConnectionOptions,
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
  const auth = (targetComponent?.auth ?? metadata?.auth ?? 'iam').toLowerCase();
  const agentProjectAlias = agentProjectConfig.name;
  const agentPath = targetComponent?.path ?? 'src/agent';

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const connectionMetadata: TsAgentReactConnectionMetadata = {
    auth,
    protocol: targetComponent?.protocol ?? 'http',
  };

  if ((targetComponent?.protocol ?? '').toLowerCase() === 'a2a') {
    throw new Error(
      `Cannot connect a React website to an A2A agent. ` +
        `Consider generating an agent with the HTTP or AG-UI protocol instead.`,
    );
  }

  if (targetComponent?.protocol === 'ag-ui') {
    await addAgUiReactConnection(tree, {
      frontendProjectConfig,
      agentName,
      agentNameClassName,
      auth: auth as AgUiAuth,
    });

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
