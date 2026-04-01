/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
  updateJson,
} from '@nx/devkit';
import { runtimeConfigGenerator } from '../../react-website/runtime-config/generator';
import { toScopeAlias } from '../../../utils/npm-scope';
import { withVersions } from '../../../utils/versions';
import { addSingleImport, applyGritQL, matchGritQL } from '../../../utils/ast';
import { toClassName } from '../../../utils/names';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  ComponentMetadata,
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { addStrandsAgentTargetToServeLocal } from './serve-local';
import { ResolvedConnectionOptions } from '../../../connection/generator';

export const TS_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsStrandsAgentReactConnectionGenerator(
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
  const auth = targetComponent?.auth ?? metadata?.auth ?? 'IAM';
  const agentProjectAlias = toScopeAlias(agentProjectConfig.name);
  const agentPath = targetComponent?.path ?? 'src/agent';

  // Ensure the agent project has a wildcard path entry in tsconfig.base.json
  // so that deep imports (e.g., for the router type) resolve correctly
  ensureWildcardPathEntry(
    tree,
    agentProjectConfig.name,
    agentProjectConfig.root,
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
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
      __dirname,
      '../../../utils/files/website/components/tanstack-query',
    ),
    joinPathFragments(frontendProjectConfig.sourceRoot, 'components'),
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  if (auth === 'IAM') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, '../../../utils/files/website/hooks/sigv4'),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'hooks'),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  }

  await runtimeConfigGenerator(tree, {
    project: frontendProjectConfig.name,
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
  if (
    !(await matchGritQL(
      tree,
      mainTsxPath,
      '`<QueryClientProvider>$_</QueryClientProvider>`',
    ))
  ) {
    await applyGritQL(
      tree,
      mainTsxPath,
      '`<App />` => `<QueryClientProvider><App /></QueryClientProvider>`',
    );
  }

  // Wrap <App /> in the agent client provider if not already present
  if (
    !(await matchGritQL(
      tree,
      mainTsxPath,
      `\`<${clientProviderName}>$_</${clientProviderName}>\``,
    ))
  ) {
    await applyGritQL(
      tree,
      mainTsxPath,
      `\`<App />\` => \`<${clientProviderName}><App /></${clientProviderName}>\``,
    );
  }

  await addStrandsAgentTargetToServeLocal(
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

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@trpc/client',
      '@tanstack/react-query',
      '@tanstack/react-query-devtools',
      '@trpc/tanstack-react-query',
      ...((auth === 'IAM'
        ? [
            'oidc-client-ts',
            'aws4fetch',
            '@aws-sdk/credential-providers',
            'react-oidc-context',
          ]
        : []) as any),
      ...((auth === 'Cognito' ? ['react-oidc-context'] : []) as any),
    ]),
    withVersions(['@smithy/types']),
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default tsStrandsAgentReactConnectionGenerator;

/**
 * Ensures a wildcard path entry exists in tsconfig.base.json for the given project,
 * allowing deep imports (e.g., `:scope/project/src/agent/router.js`).
 * Both the scope alias and npm package name forms are added.
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

  const wildcardValue = [`./${projectRoot}/*`];
  const scopeAlias = toScopeAlias(projectName);

  updateJson(tree, tsconfigPath, (json) => {
    const paths = json.compilerOptions?.paths ?? {};
    // Add wildcard for the scope alias (used by generated templates)
    const scopeWildcardKey = `${scopeAlias}/*`;
    if (!paths[scopeWildcardKey]) {
      paths[scopeWildcardKey] = wildcardValue;
    }
    // Also add wildcard for the npm package name
    const npmWildcardKey = `${projectName}/*`;
    if (!paths[npmWildcardKey]) {
      paths[npmWildcardKey] = wildcardValue;
    }
    json.compilerOptions = {
      ...json.compilerOptions,
      paths,
    };
    return json;
  });
}
