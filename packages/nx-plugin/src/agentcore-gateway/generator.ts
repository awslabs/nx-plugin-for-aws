/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addTsDependencies } from '../utils/add-dependencies.js';
import {
  AGENT_CORE_CONSTRUCTS_DEPENDENCIES,
  AGENT_CORE_CONSTRUCTS_PY_DEPENDENCIES,
  addAgentCoreGatewayInfra,
} from '../utils/agent-core-constructs/agent-core-constructs.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../utils/format.js';
import { resolveIac } from '../utils/iac.js';
import { installDependencies } from '../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics.js';
import { kebabCase, toClassName } from '../utils/names.js';
import { getNpmScopePrefix } from '../utils/npm-scope.js';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
  readProjectConfigurationUnqualified,
} from '../utils/nx.js';
import { assignPort } from '../utils/port.js';
import { ensureProjectPackageJson } from '../utils/project-package-json.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../utils/shared-constructs.js';
import type { IacMetadata } from '../utils/shared-constructs-constants.js';
import type { AgentcoreGatewayGeneratorSchema } from './schema';

// The gateway's local-dev server needs these whatever the auth; only the MCP
// SDK is protocol-specific (the http local gateway is a plain proxy). Cedar
// policy rendering adds nothing here: the CDK construct's `ejs` belongs to the
// shared constructs project, and the Terraform script uses only Node's
// standard library.
export const DEPENDENCIES = declareDependencies<AgentCoreGatewayMetadata>()({
  ts: [
    { name: '@modelcontextprotocol/sdk', when: (m) => m.protocol === 'mcp' },
    { name: 'express' },
    { name: '@types/express', dev: true },
    // local-dev.ts runs via tsx, which is shared tooling.
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(AGENT_CORE_CONSTRUCTS_DEPENDENCIES),
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
  py: ownedElsewhere(AGENT_CORE_CONSTRUCTS_PY_DEPENDENCIES),
});

export const AGENTCORE_GATEWAY_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const agentcoreGatewayGenerator = async (
  tree: Tree,
  options: AgentcoreGatewayGeneratorSchema,
): Promise<GeneratorCallback> => {
  const name = kebabCase(options.name);
  const nameClassName = toClassName(name);
  const parentDir = options.directory ?? 'packages';
  const subDir = options.subDirectory ?? name;
  const projectRoot = joinPathFragments(parentDir, subDir);
  const fullyQualifiedName = `${getNpmScopePrefix(tree)}${name}`;

  // Protocol is mcp (aggregate MCP server targets into one MCP endpoint) or
  // http (proxy agent runtime targets via path-based routing). Persisted in
  // metadata so connection generators can validate it.
  const protocol = options.protocol ?? 'mcp';
  // Inbound auth is iam (default) or cognito. Persisted in metadata so
  // connection generators can validate it (agent -> gateway connections
  // require an IAM gateway).
  const auth = options.auth ?? 'iam';
  // Cedar policies authorize MCP tool actions, which an http gateway has none
  // of — its runtime targets are plain proxied endpoints — so the policy
  // engine only applies to mcp gateways. cedarPolicy defaults to true in the
  // schema, so an http gateway quietly drops it rather than requiring
  // --cedarPolicy=false.
  if (protocol === 'http' && options.cedarPolicy) {
    logger.warn(
      'Cedar policies authorize MCP tool actions, so cedarPolicy is ignored for http-protocol gateways.',
    );
  }
  const cedarPolicy = protocol === 'mcp' && (options.cedarPolicy ?? true);
  const infra = options.infra ?? 'agentcore';

  // local-dev.ts is the local gateway: a continuous MCP aggregator chaining
  // onto attached MCP servers' dev targets (added by the mcp-connection
  // generator), so a single `nx dev <gateway>` boots the gateway and every
  // attached MCP server together.
  //
  // `serve` exists for parity with other generators; the deployed Gateway is
  // a managed AWS resource, so `serve`-mode agents talk to it via runtime
  // config and the local gateway sits idle.
  const localGatewayTarget = (port: number) => ({
    executor: 'nx:run-commands' as const,
    continuous: true,
    options: {
      command: 'tsx local-dev.ts',
      cwd: '{projectRoot}',
      env: { PORT: `${port}` },
    },
    dependsOn: [] as Array<string | { projects: string[]; target: string }>,
  });
  let project: ProjectConfiguration;
  if (projectExists(tree, fullyQualifiedName)) {
    project = readProjectConfigurationUnqualified(tree, fullyQualifiedName);
  } else {
    addProjectConfiguration(tree, fullyQualifiedName, {
      name: fullyQualifiedName,
      root: projectRoot,
      projectType: 'library',
      sourceRoot: projectRoot,
      tags: [],
      targets: {},
      metadata: {
        generator: AGENTCORE_GATEWAY_GENERATOR_INFO.id,
      } as any,
    });
    project = readProjectConfigurationUnqualified(tree, fullyQualifiedName);
  }
  // Ensure the project has its own package.json so its runtime dependencies
  // (added below) are declared in it rather than the workspace root.
  ensureProjectPackageJson(tree, {
    dir: projectRoot,
    fullyQualifiedName,
  });
  const port = assignPort(tree, project, 8100);
  // A gateway is its own standalone project, so it uses plain `serve` / `dev`
  // targets. Re-run: keep existing targets (their dependsOn may have been
  // populated by the mcp-connection generator), just ensure both exist.
  project.targets ??= {};
  project.targets['serve'] ??= localGatewayTarget(port);
  project.targets['dev'] ??= localGatewayTarget(port);
  updateProjectConfiguration(tree, project.name, project);

  // Scaffold the gateway project: local-dev.ts (+ Cedar policies if requested)
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'project', protocol),
    projectRoot,
    {
      nameClassName,
      nameKebabCase: name,
      port,
      attachedMcpServers: [],
      attachedAgents: [],
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  if (cedarPolicy) {
    // The default permit-all policy differs by auth type: AgentCore represents
    // IAM callers as `AgentCore::IamEntity` and Cognito/JWT callers as
    // `AgentCore::OAuthUser`, so the two policies match different principals.
    generateFiles(
      tree,
      joinPathFragments(import.meta.dirname, 'files', 'cedar'),
      projectRoot,
      { nameClassName, auth },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  // Recorded in the metadata below so the version sync can tell a CDK
  // project from a Terraform one; undefined when no infrastructure was
  // generated, in which case neither provider's packages were added.
  const iac =
    infra !== 'none' ? await resolveIac(tree, options.iac) : undefined;

  // Recorded below and read by the declaration's predicates, so the packages
  // added here are exactly the ones the version sync will own.
  const metadata: AgentCoreGatewayMetadata = {
    name,
    rc: nameClassName,
    protocol,
    auth,
    port,
    ...(iac ? { iac } : {}),
  };

  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    AGENTCORE_GATEWAY_GENERATOR_INFO,
    metadata,
  );

  addTsDependencies(tree, DEPENDENCIES, { metadata, projectRoot });

  // Wire up infra (CDK or Terraform); re-running with infra=agentcore adds
  // the infrastructure to a previously infra-less gateway.

  if (infra === 'agentcore') {
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);

    await addAgentCoreGatewayInfra(
      tree,
      {
        gatewayNameClassName: nameClassName,
        gatewayNameKebabCase: name,
        projectName: fullyQualifiedName,
        projectDirectory: projectRoot,
        cedarPolicy,
        auth,
        protocol,
        iac,
      },
      DEPENDENCIES,
    );
  }

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

/**
 * Gateway details stored in the gateway project's metadata.
 */
export interface AgentCoreGatewayMetadata extends IacMetadata {
  name: string;
  rc: string;
  protocol: string;
  auth: string;
  port: number;
}

/**
 * Read a gateway project's metadata, validating it was generated by the
 * agentcore-gateway generator.
 */
export const readAgentCoreGatewayMetadata = (
  project: ProjectConfiguration,
): AgentCoreGatewayMetadata => {
  const metadata = project.metadata as any;
  if (metadata?.generator !== AGENTCORE_GATEWAY_GENERATOR_INFO.id) {
    throw new Error(
      `Project '${project.name}' was not generated by the '${AGENTCORE_GATEWAY_GENERATOR_INFO.id}' generator.`,
    );
  }
  return metadata as AgentCoreGatewayMetadata;
};

export default agentcoreGatewayGenerator;
