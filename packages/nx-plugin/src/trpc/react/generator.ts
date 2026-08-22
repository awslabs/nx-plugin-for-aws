/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { AGENTCORE_HARNESS_TRPC_CONNECTION_GENERATOR_INFO } from '../../agentcore-harness/trpc-connection/generator';
import { addTargetToLocalDev } from '../../connection/local-dev';
import {
  type AgUiAuth,
  addAgUiReactConnection,
  DEPENDENCIES as AGUI_DEPENDENCIES,
  resolveAgUiTheme,
} from '../../ts/react-website/agui/generator';
import { runtimeConfigGenerator } from '../../ts/react-website/runtime-config/generator';
import { addTsDependencies } from '../../utils/add-dependencies';
import { addSingleImport, applyGritQL } from '../../utils/ast';
import {
  declareDependencies,
  onlyWhen,
  ownedElsewhere,
} from '../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../utils/format';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import {
  addComponentGeneratorMetadata,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { toProjectRelativePath } from '../../utils/paths';
import type { ReactGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TrpcReactMetadata {
  readonly auth: string;
  /** Whether the backend is a REST API, which needs the SSE polyfill. */
  readonly isRestApi: boolean;
  /**
   * The AG-UI theme module, set only when this connection also wires an
   * AgentCore Harness's `/agui` route into the website (the backend API has
   * an `agentcore-harness#trpc-connection` component).
   */
  readonly theme?: string;
}

/** The harness-AG-UI path, whose packages `addAgUiReactConnection` adds. */
const hasHarnessAgui = (m: TrpcReactMetadata) => m.theme !== undefined;

// Each entry names the auth and API-type branch it belongs to, so the same
// declaration drives both adding and the version sync.
export const DEPENDENCIES = declareDependencies<TrpcReactMetadata>()({
  ts: [
    { name: '@trpc/client' },
    { name: '@trpc/tanstack-react-query' },
    { name: '@tanstack/react-query' },
    { name: '@tanstack/react-query-devtools' },
    { name: 'event-source-polyfill', when: (m) => m.isRestApi },
    { name: 'oidc-client-ts', when: (m) => m.auth === 'iam' },
    { name: 'aws4fetch', when: (m) => m.auth === 'iam' },
    {
      name: '@aws-sdk/credential-provider-cognito-identity',
      when: (m) => m.auth === 'iam',
    },
    {
      name: 'react-oidc-context',
      when: (m) => m.auth === 'iam' || m.auth === 'cognito',
    },
    { name: '@smithy/types', dev: true },
    {
      name: '@types/event-source-polyfill',
      when: (m) => m.isRestApi,
      dev: true,
    },
    // `addAgUiReactConnection` adds these itself, so they are declared for
    // ownership only, gated on whether this connection wired a Harness's
    // `/agui` route.
    ...ownedElsewhere(onlyWhen(AGUI_DEPENDENCIES.ts, hasHarnessAgui)),
  ],
});

export const TRPC_REACT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export async function reactGenerator(
  tree: Tree,
  options: ReactGeneratorSchema,
) {
  const frontendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.frontendProjectName,
  );
  const backendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.backendProjectName,
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const metadata = backendProjectConfig.metadata as any;
  const apiName = metadata.apiName;
  const auth = (metadata.auth ?? 'iam').toLowerCase();
  const port = metadata.port ?? metadata.ports?.[0] ?? 2022;
  const rawInfra = (metadata.infra ?? metadata.computeType ?? '').toLowerCase();
  const isRestApi =
    rawInfra === 'rest-lambda' || rawInfra === 'serverlessapigatewayrestapi';
  const apiNameClassName = toClassName(apiName);
  const backendProjectAlias = backendProjectConfig.name;

  // The API's own components include an entry per connected AgentCore
  // Harness (added by `agentcore-harness#trpc-connection`), each exposing a
  // `/agui` route on this same API. Point a stock `HttpAgent` at it for each.
  const harnessComponents: ComponentMetadata[] = (
    (backendProjectConfig.metadata as any)?.components ?? []
  ).filter(
    (c: ComponentMetadata) =>
      c.generator === AGENTCORE_HARNESS_TRPC_CONNECTION_GENERATOR_INFO.id,
  );
  const theme =
    harnessComponents.length > 0
      ? resolveAgUiTheme(frontendProjectConfig)
      : undefined;

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const connectionMetadata: TrpcReactMetadata = { auth, isRestApi, theme };

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    frontendProjectConfig.root,
    {
      apiName,
      apiNameClassName: toClassName(apiName),
      ...options,
      auth,
      isRestApi,
      backendProjectAlias,
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
      '../../utils/files/website/components/tanstack-query',
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
        '../../utils/files/website/hooks/sigv4',
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

  const clientProviderName = `${apiNameClassName}ClientProvider`;
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

  // Wrap <App /> in the tRPC client provider if not already present
  await applyGritQL(
    tree,
    mainTsxPath,
    `\`<App />\` => \`<${clientProviderName}><App /></${clientProviderName}>\` where { $program <: not contains \`<${clientProviderName}>$_</${clientProviderName}>\` }`,
  );

  await addTargetToLocalDev(
    tree,
    frontendProjectConfig.name,
    backendProjectConfig.name,
    {
      url: `http://localhost:${port}/`,
      apiName,
    },
  );

  addTsDependencies(tree, DEPENDENCIES, {
    metadata: connectionMetadata,
    projectRoot: frontendProjectConfig.root,
  });

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    frontendProjectConfig.name,
    TRPC_REACT_GENERATOR_INFO,
    toProjectRelativePath(
      frontendProjectConfig,
      joinPathFragments(
        frontendProjectConfig.sourceRoot,
        'components',
        clientProviderName,
      ),
    ),
    apiNameClassName,
    connectionMetadata,
  );

  // Reuses `addAgUiReactConnection`'s provider/theme/registration wiring
  // unchanged — the only harness-specific difference is the URL: the API's
  // own `/agui` route (this same connection's URL, plus `/agui`) instead of
  // an agent runtime's `/invocations` endpoint.
  for (const harnessComponent of harnessComponents) {
    const agentNameClassName = harnessComponent.name!;
    const agentName = kebabCase(agentNameClassName);

    await addAgUiReactConnection(tree, {
      frontendProjectConfig,
      agentName,
      agentNameClassName,
      auth: auth as AgUiAuth,
      harnessRoute: { apiNameClassName },
    });

    // Recorded so the version sync knows this connection's AG-UI dependencies
    // are ours, once per connected Harness.
    addComponentGeneratorMetadata(
      tree,
      frontendProjectConfig.name,
      TRPC_REACT_GENERATOR_INFO,
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
  }

  await addGeneratorMetricsIfApplicable(tree, [TRPC_REACT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
}
export default reactGenerator;
