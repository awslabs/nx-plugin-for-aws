/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { addAgentRuntimeToConnectionNamespace } from '../../../connection/agent-runtime-config';
import { addTsDependencies } from '../../../utils/add-dependencies';
import {
  addDestructuredImport,
  addSingleImport,
  applyGritQL,
} from '../../../utils/ast';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../../utils/declared-dependencies';
import { kebabCase } from '../../../utils/names';
import { getNpmScopePrefix } from '../../../utils/npm-scope';
import { registerPnpmBuiltDependencies } from '../../../utils/pnpm-workspace';
import {
  SHADCN_DEPENDENCIES,
  sharedShadcnGenerator,
} from '../../../utils/shared-shadcn';
import { runtimeConfigGenerator } from '../runtime-config/generator';

/**
 * The values this helper's predicates read. Its callers record them, so the
 * theme and auth branches taken here can be confirmed at upgrade time.
 */
export interface AgUiMetadata {
  readonly theme: string;
  readonly auth: string;
}

// Each entry names the theme or auth branch it belongs to, so the same
// declaration drives both adding and the version sync.
export const DEPENDENCIES = declareDependencies<AgUiMetadata>()({
  ts: [
    { name: '@copilotkit/react-core' },
    { name: '@ag-ui/client' },
    {
      name: '@cloudscape-design/chat-components',
      when: (m) => m.theme === 'cloudscape',
    },
    { name: 'lucide-react', when: (m) => m.theme === 'shadcn' },
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
    { name: '@smithy/types', when: (m) => m.auth === 'iam', dev: true },
    // `sharedShadcnGenerator` adds these to the shared shadcn project it
    // creates, not to the website.
    ...ownedElsewhere(SHADCN_DEPENDENCIES),
  ],
});

export type AgUiAuth = 'iam' | 'cognito' | 'none';

export type AgUiTheme = 'cloudscape' | 'shadcn' | 'default';

export interface AgUiReactConnectionOptions {
  /** The React website project to connect FROM */
  frontendProjectConfig: ProjectConfiguration;
  /** The AG-UI agent's exposed name (used as CopilotKit's agent key) */
  agentName: string;
  /** PascalCase class name used for component names and runtime config keys */
  agentNameClassName: string;
  /** Auth scheme used by the agent */
  auth: AgUiAuth;
  /**
   * When set, the generated hook reads the gateway's URL from
   * runtimeConfig.gateways and routes to the agent via the gateway's
   * path-based `/<targetName>/invocations` route instead of invoking the
   * runtime directly. The gateway publishes its own URL to the website, so
   * the agent's construct is left unpatched.
   */
  gatewayRoute?: {
    gatewayClassName: string;
    targetName: string;
  };
  /**
   * When set, the generated hook reads the connected tRPC API's URL from
   * runtimeConfig.apis and routes to that API's `/agui` route (an
   * AgentCore Harness behind it) instead of invoking an agent runtime
   * directly. The API publishes its own URL to the website already (via
   * the `ts#react-website -> ts#trpc-api` connection), so no runtime/gateway
   * construct is patched for this route.
   */
  harnessRoute?: {
    apiNameClassName: string;
  };
}

/**
 * Wires a React website up to an AG-UI agent using CopilotKit and
 * @ag-ui/client's HttpAgent. Agent-server-language agnostic.
 *
 * On first invocation creates a shared `AguiProvider` component (with an empty
 * `selfManagedAgents` registry) and wraps `<App />` in it. Each invocation
 * AST-patches `AguiProvider` to register one more agent hook — running the
 * generator multiple times is idempotent and additive.
 *
 * Also vends a `src/components/copilot` theme module picked from the
 * website's `metadata.ux` (cloudscape / shadcn / default).
 */
export const addAgUiReactConnection = async (
  tree: Tree,
  options: AgUiReactConnectionOptions,
) => {
  const {
    frontendProjectConfig,
    agentName,
    agentNameClassName,
    auth,
    gatewayRoute,
    harnessRoute,
  } = options;

  const theme = resolveAgUiTheme(frontendProjectConfig);
  // The values the declaration's predicates read. Callers record the same pair,
  // so what is added here is exactly what the version sync owns.
  const metadata: AgUiMetadata = { theme, auth };
  const scopeAlias = getNpmScopePrefix(tree);

  // Generates `src/components/AguiProvider.tsx` (if absent) and
  // `src/hooks/useAgui<AgentName>.tsx`. Existing files are kept so re-running
  // the generator is idempotent.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'common'),
    frontendProjectConfig.root,
    { agentName, agentNameClassName, auth, gatewayRoute, harnessRoute },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Shadcn theme imports from the shared shadcn library, so it must exist.
  if (theme === 'shadcn') {
    await sharedShadcnGenerator(tree, DEPENDENCIES);
  }
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', theme),
    frontendProjectConfig.root,
    { scopeAlias },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
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
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  await runtimeConfigGenerator(tree, {
    project: frontendProjectConfig.name,
  });

  // AST-patch AguiProvider to register this agent's hook
  await registerAgentHookInProvider(
    tree,
    frontendProjectConfig,
    agentNameClassName,
  );

  // Wrap <App /> in <AguiProvider> in main.tsx (idempotent)
  const mainTsxPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'main.tsx',
  );
  await addSingleImport(
    tree,
    mainTsxPath,
    'AguiProvider',
    './components/AguiProvider',
  );
  await applyGritQL(
    tree,
    mainTsxPath,
    `\`<App />\` => \`<AguiProvider><App /></AguiProvider>\` where { $program <: not contains \`<AguiProvider>$_</AguiProvider>\` }`,
  );

  // @copilotkit/react-core transitively pulls in @scarf/scarf (telemetry),
  // which has a postinstall script. Under pnpm 11's default
  // `strictDepBuilds=true` that script is treated as an unreviewed build and
  // fails the install. Register it as an explicitly-rejected build so pnpm
  // knows we've seen it and will skip it instead of erroring.
  registerPnpmBuiltDependencies(tree, { '@scarf/scarf': false });

  addTsDependencies(tree, DEPENDENCIES, {
    metadata,
    projectRoot: frontendProjectConfig.root,
  });

  // Agents only publish their runtime ARN to the 'agentcore' namespace by
  // default, which isn't exposed to the website. Patch the agent's CDK/TF
  // construct to also publish under 'connection' so the browser can read it
  // from runtime-config.json. When routing via a gateway or a harness's API,
  // that project already publishes its own URL instead.
  if (!gatewayRoute && !harnessRoute) {
    await addAgentRuntimeToConnectionNamespace(tree, {
      agentNameKebabCase: kebabCase(agentNameClassName),
      agentNameClassName,
    });
  }
};

/**
 * The theme module this helper vends, from the website's `metadata.ux`. Callers
 * record the resolved value, so the theme predicates read what the code branches
 * on.
 */
export const resolveAgUiTheme = (
  frontendProjectConfig: ProjectConfiguration,
): AgUiTheme => {
  const ux = (
    (frontendProjectConfig.metadata as any)?.ux as string | undefined
  )?.toLowerCase();
  switch (ux) {
    case 'cloudscape':
      return 'cloudscape';
    case 'shadcn':
      return 'shadcn';
    default:
      return 'default';
  }
};

/**
 * Register this agent's hook in the shared `AguiProvider` using GritQL AST
 * patches. The provider starts out with an empty `selfManagedAgents` registry
 * (from the template); each call appends:
 *   - `import { useAgui<Name> } from '../hooks/useAgui<Name>';`
 *   - `const <varName> = useAgui<Name>();` before the `useMemo` call
 *   - `...<varName>` into the memoised object literal
 *   - `<varName>` into the `useMemo` deps array
 *
 * All steps are guarded so re-running produces byte-identical output.
 */
const registerAgentHookInProvider = async (
  tree: Tree,
  frontendProjectConfig: ProjectConfiguration,
  agentNameClassName: string,
) => {
  const providerPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'components',
    'AguiProvider.tsx',
  );
  const hookName = `useAgui${agentNameClassName}`;
  // useAguiStoryAgent -> storyAgentAgents
  const varName = `${agentNameClassName.charAt(0).toLowerCase()}${agentNameClassName.slice(1)}Agents`;

  // 1. Add the hook import
  await addDestructuredImport(
    tree,
    providerPath,
    [hookName],
    `../hooks/${hookName}`,
  );

  // 2. Insert `const <varName> = <hookName>();` before the useMemo declaration
  await applyGritQL(
    tree,
    providerPath,
    `\`const selfManagedAgents = useMemo<Record<string, AbstractAgent>>($body, $deps);\` => ` +
      `\`const ${varName} = ${hookName}();\nconst selfManagedAgents = useMemo<Record<string, AbstractAgent>>($body, $deps);\` ` +
      `where { $program <: not contains \`const ${varName} = ${hookName}()\` }`,
  );

  // 3. Spread `...<varName>` into the memoised object and add `<varName>` to
  //    the deps array. Branches on `{}`/`[]` vs populated so both the
  //    first-agent and nth-agent cases produce clean output.
  await applyGritQL(
    tree,
    providerPath,
    `\`useMemo<Record<string, AbstractAgent>>(() => ($obj), $deps)\` where {` +
      ` $obj <: not contains \`...${varName}\`,` +
      ` if ($obj <: \`{}\`) { $obj => \`{ ...${varName} }\` }` +
      ` else { $obj <: \`{$items}\` where { $items += \`, ...${varName}\` } },` +
      ` if ($deps <: \`[]\`) { $deps => \`[${varName}]\` }` +
      ` else { $deps <: \`[$dd]\` where { $dd += \`, ${varName}\` } }` +
      ` }`,
  );
};
