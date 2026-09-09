/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  addAguiRouteToApi,
  addAguiRouteToTerraformApi,
} from '../../connection/harness-trpc-config';
import type { TsTrpcApiMetadata } from '../../trpc/backend/generator';
import { addTsDependencies } from '../../utils/add-dependencies';
import { addDestructuredImport, applyGritQL } from '../../utils/ast';
import {
  addTypeScriptBundleTarget,
  BUNDLE_DEPENDENCIES,
} from '../../utils/bundle/bundle';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../utils/format';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { esmVars } from '../../utils/module-format';
import { kebabCase, toClassName } from '../../utils/names';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { readAgentCoreHarnessMetadata } from '../generator';
import type { AgentcoreHarnessTrpcConnectionGeneratorSchema } from './schema';

// The AG-UI route + mapper need these regardless of the connection's options.
// `rolldown` is only listed for the version sync — the `bundle` target it
// backs is already installed by the underlying ts#trpc-api project.
export const DEPENDENCIES = declareDependencies()({
  ts: [
    { name: '@aws-sdk/client-bedrock-agentcore' },
    { name: '@ag-ui/core' },
    { name: '@ag-ui/encoder' },
    ...ownedElsewhere(BUNDLE_DEPENDENCIES),
  ],
});

/** Workspace-root-relative directory the AG-UI handler's rolldown bundle is written to. */
const AGUI_BUNDLE_SUBDIR = 'agui';

export const AGENTCORE_HARNESS_TRPC_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a ts#trpc-api project to an AgentCore Harness.
 *
 * Generates a `POST /agui` streaming route on the API that authenticates the
 * caller (reusing the API's existing authorizer), pins every
 * system-controlled Harness field server-side, forwards only the caller's
 * messages to `InvokeHarness`, and translates the Converse-style response
 * stream into AG-UI server-sent events — so the API becomes a standard AG-UI
 * endpoint any `@ag-ui/client` (or bring-your-own AG-UI client) can connect
 * to by URL alone. Also generates an optional `history` tRPC procedure that
 * reconstructs a conversation from AgentCore Memory.
 *
 * The Harness itself is never exposed to the browser: `InvokeHarness`
 * accepts per-invocation overrides for the system prompt, model, tools and
 * actor id, so a trusted server-side caller (this API) is required per the
 * AgentCore Harness security guidance.
 */
export const trpcAgentCoreHarnessConnectionGenerator = async (
  tree: Tree,
  options: AgentcoreHarnessTrpcConnectionGeneratorSchema,
): Promise<() => void | Promise<void>> => {
  const apiProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const harnessProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );
  const harnessMetadata = readAgentCoreHarnessMetadata(harnessProject);

  const apiMetadata = apiProject.metadata as any as TsTrpcApiMetadata;
  if (apiMetadata?.infra !== 'rest-lambda') {
    throw new Error(
      `AgentCore Harness connections require a ts#trpc-api generated with infra: 'rest-lambda' (the AG-UI route needs a streaming response), but '${apiProject.name}' was generated with infra: '${apiMetadata?.infra}'.`,
    );
  }

  const apiNameKebabCase = kebabCase(apiMetadata.apiName);
  const apiNameClassName = toClassName(apiMetadata.apiName);
  const esm = esmVars(tree);

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'agui'),
    joinPathFragments(apiProject.root, 'src', 'agui'),
    { ...esm, harnessNameClassName: harnessMetadata.rc },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'procedures'),
    joinPathFragments(apiProject.root, 'src', 'procedures'),
    { ...esm },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await registerHistoryProcedure(tree, apiProject.root, esm.esm);

  addTsDependencies(tree, DEPENDENCIES, { projectRoot: apiProject.root });

  // Bundled with rolldown via the API project's own nx-cached `bundle`
  // target (the same one ts#trpc-api already uses for its router handler),
  // rather than CDK's NodejsFunction, which re-runs esbuild on every synth.
  // Both CDK and Terraform package this same bundle output as their Lambda
  // asset. Mutates the in-memory `apiProject`, so this — and the
  // `updateProjectConfiguration` that persists it — must come before
  // `addComponentGeneratorMetadata`, which reads and writes the tree's own
  // (fresher) copy of the project's metadata.
  await addTypeScriptBundleTarget(
    tree,
    apiProject,
    {
      targetFilePath: 'src/agui/handler.ts',
      bundleOutputDir: AGUI_BUNDLE_SUBDIR,
    },
    DEPENDENCIES,
  );
  updateProjectConfiguration(tree, apiProject.name, apiProject);

  addComponentGeneratorMetadata(
    tree,
    apiProject.name,
    AGENTCORE_HARNESS_TRPC_CONNECTION_GENERATOR_INFO,
    harnessProject.root,
    harnessMetadata.rc,
  );

  const bundleOutputDir = joinPathFragments(
    'dist',
    apiProject.root,
    'bundle',
    AGUI_BUNDLE_SUBDIR,
  );

  await addAguiRouteToApi(tree, {
    apiNameKebabCase,
    apiNameClassName,
    harnessNameKebabCase: harnessMetadata.name,
    harnessNameClassName: harnessMetadata.rc,
    iac: apiMetadata.iac,
    auth: apiMetadata.auth,
    integrationPattern: apiMetadata.integrationPattern,
    bundleOutputDir,
  });

  addAguiRouteToTerraformApi(tree, {
    apiNameKebabCase,
    apiNameClassName,
    harnessNameKebabCase: harnessMetadata.name,
    harnessNameClassName: harnessMetadata.rc,
    iac: apiMetadata.iac,
    auth: apiMetadata.auth,
    integrationPattern: apiMetadata.integrationPattern,
    bundleOutputDir,
  });

  logger.info(
    `Add 'agui' route wiring to your application stack: <${apiNameClassName} instance>.addAguiRoute(<${harnessMetadata.rc} instance>);`,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_HARNESS_TRPC_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

/** Registers the generated `history` procedure on the API's tRPC router; idempotent. */
const registerHistoryProcedure = async (
  tree: Tree,
  apiProjectRoot: string,
  esm: boolean,
): Promise<void> => {
  const routerPath = joinPathFragments(apiProjectRoot, 'src', 'router.ts');
  if (!tree.exists(routerPath)) {
    return;
  }

  await addDestructuredImport(
    tree,
    routerPath,
    ['history'],
    esm ? './procedures/history.js' : './procedures/history',
  );

  // Appends after the last property rather than rewriting the whole `{ $props
  // }` list with `=>`: GritQL binds a property list to its trailing comma
  // too, so re-emitting `{ $props, history }` would duplicate it.
  await applyGritQL(
    tree,
    routerPath,
    '`router({ $props })` => `router({ $props })` where { $props <: not contains `history`, $props <: [$..., $last], $last += `, history` }',
  );
};

export default trpcAgentCoreHarnessConnectionGenerator;
