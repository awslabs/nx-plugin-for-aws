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
import { addTargetToLocalDev } from '../../connection/local-dev.js';
import { runtimeConfigGenerator } from '../../ts/react-website/runtime-config/generator.js';
import { addTsDependencies } from '../../utils/add-dependencies.js';
import { addSingleImport, applyGritQL } from '../../utils/ast.js';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { installDependencies } from '../../utils/install.js';
import { addLocalProjectDependency } from '../../utils/local-project-dependency.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { toClassName } from '../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { toProjectRelativePath } from '../../utils/paths.js';
import type { ReactGeneratorSchema } from './schema';

/** The metadata this generator records, which its predicates read. */
export interface TrpcReactMetadata {
  readonly auth: string;
  /** Whether the backend is a REST API, which needs the SSE polyfill. */
  readonly isRestApi: boolean;
}

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

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const connectionMetadata: TrpcReactMetadata = { auth, isRestApi };

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

  // The generated client provider imports the API project's router type.
  addLocalProjectDependency(tree, {
    consumerRoot: frontendProjectConfig.root,
    dependencyRoot: backendProjectConfig.root,
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

  await addGeneratorMetricsIfApplicable(tree, [TRPC_REACT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
}
export default reactGenerator;
