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
  updateJson,
} from '@nx/devkit';
import { addStarExport } from '../ast';
import type { Containers } from '../containers';
import {
  type DeclaredPyDependency,
  type DeclaredTsDependency,
  type DependencyDeclaration,
  forDependencies,
  type MustDeclare,
} from '../declared-dependencies';
import { addDependenciesToPackageJson } from '../dependencies';
import type { Iac } from '../iac';
import { esmVars } from '../module-format';
import { addDependencyToTargetIfNotPresent } from '../nx';
import {
  generatedInfrastructure,
  generatedTerraform,
  type IacMetadata,
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import {
  type IPyDepVersion,
  type ITsDepVersion,
  PY_VERSIONS,
  terraformProviderVersions,
  withVersions,
} from '../versions';

type IACProvider = { iac: Iac };

/**
 * Dependencies a caller must declare to add an AgentCore Gateway construct.
 *
 * Gated on infrastructure having been generated, since the construct helpers only
 * run on that branch.
 */
export const AGENT_CORE_CONSTRUCTS_DEPENDENCIES = [
  { name: 'ejs', when: generatedInfrastructure },
  { name: '@aws-sdk/client-bedrock-agentcore', when: generatedInfrastructure },
  { name: '@types/ejs', when: generatedInfrastructure },
] as const satisfies readonly DeclaredTsDependency<
  ITsDepVersion,
  IacMetadata
>[];

/**
 * Python versions the generated Terraform pins in an inline `uv run --with`
 * script, rather than in any `pyproject.toml`.
 *
 * Spread through `ownedElsewhere` because nothing installs them into the
 * workspace — the pin is owned so the version sync keeps it current, and gated on
 * Terraform since the CDK branch writes no such script.
 */
export const AGENT_CORE_CONSTRUCTS_PY_DEPENDENCIES = [
  { name: 'boto3', when: generatedTerraform },
  { name: 'httpx', when: generatedTerraform },
  { name: 'mcp', when: generatedTerraform },
] as const satisfies readonly DeclaredPyDependency<
  IPyDepVersion,
  IacMetadata
>[];

export type AgentCoreAuth = 'iam' | 'cognito';

export type AgentCoreSession = 's3' | 'in-memory';

export interface AddAgentCoreInfraProps {
  nameClassName: string;
  nameKebabCase: string;
  projectName: string;
  dockerImageTag: string;
  dockerOutputDir: string;
  appDirectory: string;
  serverProtocol: 'mcp' | 'http' | 'a2a';
  auth: AgentCoreAuth;
  /** How this runtime's session should be persisted. MCP servers have no session, so pass 'in-memory'. */
  session: AgentCoreSession;
  containers: Containers;
}

const addAgentCoreInfra = async (
  tree: Tree,
  options: AddAgentCoreInfraProps & { iac: Iac },
) => {
  switch (options.iac) {
    case 'cdk':
      await addAgentCoreCDKInfra(tree, options);
      break;
    case 'terraform':
      addAgentCoreTerraformInfra(tree, options);
      break;
  }

  // Update shared constructs/terraform project configuration to depend on this project
  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addDependencyToTargetIfNotPresent(
        config,
        'build',
        `${options.projectName}:build`,
      );
      return config;
    },
  );
};

const addAgentCoreCDKInfra = async (
  tree: Tree,
  options: AddAgentCoreInfraProps,
) => {
  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app', 'agent-core'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      options.appDirectory,
    ),
    { ...options, ...esmVars(tree) },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app specific CDK construct
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      options.appDirectory,
      'index.ts',
    ),
    `./${options.nameKebabCase}/${options.nameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    `./${options.appDirectory}/index.js`,
  );
};

const addAgentCoreTerraformInfra = (
  tree: Tree,
  options: AddAgentCoreInfraProps,
) => {
  // Add the AgentCore shared module
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'core',
      'agent-core',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'core',
      'agent-core',
    ),
    {
      containers: options.containers,
      boto3Version: PY_VERSIONS.boto3,
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate app specific agent core configuration
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'app',
      'agent-core',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      options.appDirectory,
    ),
    { ...options, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};

export interface AddMcpServerInfraProps {
  mcpServerNameClassName: string;
  mcpServerNameKebabCase: string;
  projectName: string;
  dockerImageTag: string;
  dockerOutputDir: string;
  auth: AgentCoreAuth;
  containers: Containers;
}

/**
 * Add an MCP server CDK construct
 */
export const addMcpServerInfra = async (
  tree: Tree,
  options: AddMcpServerInfraProps & IACProvider,
) => {
  await addAgentCoreInfra(tree, {
    nameClassName: options.mcpServerNameClassName,
    nameKebabCase: options.mcpServerNameKebabCase,
    dockerImageTag: options.dockerImageTag,
    dockerOutputDir: options.dockerOutputDir,
    projectName: options.projectName,
    appDirectory: 'mcp-servers',
    serverProtocol: 'mcp',
    iac: options.iac,
    auth: options.auth,
    // MCP servers are stateless (no conversation session to persist).
    session: 'in-memory',
    containers: options.containers,
  });
};

export interface AddAgentInfraProps {
  agentNameClassName: string;
  agentNameKebabCase: string;
  projectName: string;
  dockerImageTag: string;
  dockerOutputDir: string;
  auth: AgentCoreAuth;
  session: AgentCoreSession;
  serverProtocol?: 'http' | 'a2a';
  containers: Containers;
}

/**
 * Add an agent CDK construct
 */
export const addAgentInfra = async (
  tree: Tree,
  options: AddAgentInfraProps & IACProvider,
) => {
  await addAgentCoreInfra(tree, {
    nameClassName: options.agentNameClassName,
    nameKebabCase: options.agentNameKebabCase,
    projectName: options.projectName,
    dockerImageTag: options.dockerImageTag,
    dockerOutputDir: options.dockerOutputDir,
    appDirectory: 'agents',
    session: options.session,
    serverProtocol: options.serverProtocol ?? 'http',
    iac: options.iac,
    auth: options.auth,
    containers: options.containers,
  });
};

export interface AddAgentCoreGatewayInfraProps {
  gatewayNameClassName: string;
  gatewayNameKebabCase: string;
  projectName: string;
  projectDirectory: string;
  cedarPolicy: boolean;
  auth: AgentCoreAuth;
}

export const addAgentCoreGatewayInfra = async <
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps & IACProvider,
  declaration: D & MustDeclare<typeof AGENT_CORE_CONSTRUCTS_DEPENDENCIES, D>,
) => {
  switch (options.iac) {
    case 'cdk':
      await addAgentCoreGatewayCDKInfra(tree, options, declaration);
      break;
    case 'terraform':
      addAgentCoreGatewayTerraformInfra(tree, options);
      break;
  }

  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addDependencyToTargetIfNotPresent(
        config,
        'build',
        `${options.projectName}:build`,
      );
      return config;
    },
  );
};

const addAgentCoreGatewayCDKInfra = async (
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps,
  declaration: DependencyDeclaration,
) => {
  // Generic gateway construct (readiness probe, policy engine, Cedar policy
  // loading) shared by all gateways
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'core',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'agentcore-gateway',
    ),
    { ...esmVars(tree) },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'app',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'gateways',
    ),
    {
      nameClassName: options.gatewayNameClassName,
      nameKebabCase: options.gatewayNameKebabCase,
      projectDirectory: options.projectDirectory,
      cedarPolicy: options.cedarPolicy,
      auth: options.auth,
      ...esmVars(tree),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'index.ts',
    ),
    './agentcore-gateway/agentcore-gateway.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'gateways',
      'index.ts',
    ),
    `./${options.gatewayNameKebabCase}/${options.gatewayNameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    './gateways/index.js',
  );

  // The gateway construct renders Cedar policies with ejs and its readiness
  // probe uses the AgentCore SDK client; declare both so the lint passes.
  addDependenciesToPackageJson(
    tree,
    withVersions(
      forDependencies<typeof AGENT_CORE_CONSTRUCTS_DEPENDENCIES>(declaration),
      ['ejs', '@aws-sdk/client-bedrock-agentcore'],
    ),
    withVersions(
      forDependencies<typeof AGENT_CORE_CONSTRUCTS_DEPENDENCIES>(declaration),
      ['@types/ejs'],
    ),
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'package.json'),
  );
};

const addAgentCoreGatewayTerraformInfra = (
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps,
) => {
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'core',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'core',
      'agentcore-gateway',
    ),
    { ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'app',
      'agentcore-gateway',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      'gateways',
    ),
    {
      nameClassName: options.gatewayNameClassName,
      nameKebabCase: options.gatewayNameKebabCase,
      projectDirectory: options.projectDirectory,
      cedarPolicy: options.cedarPolicy,
      auth: options.auth,
      boto3Version: PY_VERSIONS.boto3,
      httpxVersion: PY_VERSIONS.httpx,
      mcpVersion: PY_VERSIONS.mcp,
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // The Cedar render script is only needed when policies are enabled
  if (!options.cedarPolicy) {
    const renderScript = joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      'gateways',
      options.gatewayNameKebabCase,
      'render-cedar.cjs',
    );
    if (tree.exists(renderScript)) {
      tree.delete(renderScript);
    }
  }
};
