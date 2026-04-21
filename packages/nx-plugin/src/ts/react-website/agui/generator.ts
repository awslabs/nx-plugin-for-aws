/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  ProjectConfiguration,
  Tree,
} from '@nx/devkit';
import { runtimeConfigGenerator } from '../runtime-config/generator';
import { withVersions } from '../../../utils/versions';
import {
  addDestructuredImport,
  addSingleImport,
  applyGritQL,
} from '../../../utils/ast';
import { addAgentRuntimeToConnectionNamespace } from '../../../connection/agent-runtime-config';
import { kebabCase } from '../../../utils/names';

export type AgUiAuth = 'IAM' | 'Cognito' | 'None';

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
 */
export const addAgUiReactConnection = async (
  tree: Tree,
  options: AgUiReactConnectionOptions,
) => {
  const { frontendProjectConfig, agentName, agentNameClassName, auth } =
    options;

  // Generates `src/components/AguiProvider.tsx` (if absent) and
  // `src/hooks/useAgui<AgentName>.tsx`. Existing files are kept so re-running
  // the generator is idempotent.
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    frontendProjectConfig.root,
    { agentName, agentNameClassName, auth },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  if (auth === 'IAM') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, '../../../utils/files/website/hooks/sigv4'),
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

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@copilotkit/react-core',
      '@ag-ui/client',
      ...((auth === 'IAM'
        ? [
            'oidc-client-ts',
            'aws4fetch',
            '@aws-sdk/credential-providers',
            'react-oidc-context',
            'rxjs',
          ]
        : []) as any),
      ...((auth === 'Cognito' ? ['react-oidc-context'] : []) as any),
    ]),
    withVersions([...((auth === 'IAM' ? ['@smithy/types'] : []) as any)]),
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
