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
import {
  addDestructuredImport,
  addSingleImport,
  applyGritQL,
} from '../../../utils/ast';
import { addDependenciesToPackageJson } from '../../../utils/dependencies';
import { kebabCase } from '../../../utils/names';
import { getNpmScopePrefix } from '../../../utils/npm-scope';
import { registerPnpmBuiltDependencies } from '../../../utils/pnpm-workspace';
import { sharedShadcnGenerator } from '../../../utils/shared-shadcn';
import { withVersions } from '../../../utils/versions';
import { runtimeConfigGenerator } from '../runtime-config/generator';

export type AgUiAuth = 'iam' | 'cognito' | 'none';

type AgUiTheme = 'cloudscape' | 'shadcn' | 'default';

export interface AgUiReactConnectionOptions {
  /** The React website project to connect FROM */
  frontendProjectConfig: ProjectConfiguration;
  /** The AG-UI agent's exposed name (used as CopilotKit's agent key) */
  agentName: string;
  /** PascalCase class name used for component names and runtime config keys */
  agentNameClassName: string;
  /** Auth scheme used by the agent */
  auth: AgUiAuth;
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
  const { frontendProjectConfig, agentName, agentNameClassName, auth } =
    options;

  const theme = resolveAgUiTheme(frontendProjectConfig);
  const scopeAlias = getNpmScopePrefix(tree);

  // Generates `src/components/AguiProvider.tsx` (if absent) and
  // `src/hooks/useAgui<AgentName>.tsx`. Existing files are kept so re-running
  // the generator is idempotent.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'common'),
    frontendProjectConfig.root,
    { agentName, agentNameClassName, auth },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Shadcn theme imports from the shared shadcn library, so it must exist.
  if (theme === 'shadcn') {
    await sharedShadcnGenerator(tree);
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

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@copilotkit/react-core',
      '@ag-ui/client',
      ...((theme === 'cloudscape'
        ? ['@cloudscape-design/chat-components']
        : []) as any),
      ...((theme === 'shadcn' ? ['lucide-react'] : []) as any),
      ...((auth === 'iam'
        ? [
            'oidc-client-ts',
            'aws4fetch',
            '@aws-sdk/credential-provider-cognito-identity',
            'react-oidc-context',
          ]
        : []) as any),
      ...((auth === 'cognito' ? ['react-oidc-context'] : []) as any),
    ]),
    withVersions([...((auth === 'iam' ? ['@smithy/types'] : []) as any)]),
    joinPathFragments(frontendProjectConfig.root, 'package.json'),
  );

  // Agents only publish their runtime ARN to the 'agentcore' namespace by
  // default, which isn't exposed to the website. Patch the agent's CDK/TF
  // construct to also publish under 'connection' so the browser can read it
  // from runtime-config.json.
  await addAgentRuntimeToConnectionNamespace(tree, {
    agentNameKebabCase: kebabCase(agentNameClassName),
    agentNameClassName,
  });
};

const resolveAgUiTheme = (
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
