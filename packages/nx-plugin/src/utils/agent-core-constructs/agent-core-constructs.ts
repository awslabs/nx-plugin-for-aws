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
import { addDependenciesToPackageJson } from '../dependencies';
import type { Iac } from '../iac';
import { esmVars } from '../module-format';
import { addDependencyToTargetIfNotPresent } from '../nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import {
  PY_VERSIONS,
  terraformProviderVersions,
  withVersions,
} from '../versions';

type IACProvider = { iac: Iac };

export type AgentCoreAuth = 'iam' | 'cognito';

export interface AddAgentCoreInfraProps {
  nameClassName: string;
  nameKebabCase: string;
  projectName: string;
  dockerImageTag: string;
  dockerOutputDir: string;
  appDirectory: string;
  serverProtocol: 'mcp' | 'http' | 'a2a';
  auth: AgentCoreAuth;
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
    options,
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

export const addAgentCoreGatewayInfra = async (
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps & IACProvider,
) => {
  switch (options.iac) {
    case 'cdk':
      await addAgentCoreGatewayCDKInfra(tree, options);
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
    withVersions(['ejs', '@aws-sdk/client-bedrock-agentcore']),
    withVersions(['@types/ejs']),
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

export interface AddAgentCoreHarnessInfraProps {
  harnessNameClassName: string;
  harnessNameKebabCase: string;
  /**
   * Workspace-root-relative harness project root, eg `packages/my-harness`.
   * The `src/PROMPT.md` path both templates read is derived from it.
   */
  projectRoot: string;
  /** Leading-letter-guaranteed, 31-char-truncated resource name prefix. */
  harnessNamePrefix: string;
}

/**
 * Template substitution context shared by the CDK and Terraform harness
 * branches. Both prompt path fields carry the same workspace-root-relative
 * path, named per provider so each template's usage reads on its own.
 */
interface HarnessTemplateContext {
  nameClassName: string;
  nameKebabCase: string;
  harnessNamePrefix: string;
  /** Joined onto `findWorkspaceRoot()` in the CDK construct. */
  promptPathFromCdk: string;
  /** Appended to the `path.module` walk to the workspace root in Terraform. */
  promptPathFromTerraform: string;
}

/**
 * Add AgentCore Harness infrastructure for the selected IaC provider.
 *
 * Renders the provider-specific Harness infrastructure (a CDK construct or
 * a Terraform module) into the Shared Infrastructure Project with
 * `KeepExisting`, so existing files become user-owned and are never
 * rewritten by reruns.
 *
 * Unlike agents, MCP servers and gateways, no build dependency is added
 * from the shared infrastructure project to the Harness Project: generated
 * Harness infrastructure does not import Harness Project source, so a
 * dependency would only create false rebuild coupling.
 */
export const addAgentCoreHarnessInfra = async (
  tree: Tree,
  options: AddAgentCoreHarnessInfraProps & IACProvider,
): Promise<void> => {
  // One resolved template context, built once and passed to both provider
  // branches. The prompt path is derived from the same projectRoot the
  // Harness Project is written to, so explicit placement needs no extra logic.
  const promptPath = joinPathFragments(options.projectRoot, 'src', 'PROMPT.md');
  const templateContext: HarnessTemplateContext = {
    nameClassName: options.harnessNameClassName,
    nameKebabCase: options.harnessNameKebabCase,
    harnessNamePrefix: options.harnessNamePrefix,
    promptPathFromCdk: promptPath,
    promptPathFromTerraform: promptPath,
  };

  switch (options.iac) {
    case 'cdk':
      await addAgentCoreHarnessCDKInfra(tree, templateContext);
      break;
    case 'terraform':
      addAgentCoreHarnessTerraformInfra(tree, templateContext);
      break;
  }
};

const addAgentCoreHarnessCDKInfra = async (
  tree: Tree,
  templateContext: HarnessTemplateContext,
) => {
  // Generate the app specific CDK construct under
  // src/app/harnesses/<kebab-case-name>/
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'cdk',
      'app',
      'agentcore-harness',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'harnesses',
    ),
    { ...templateContext, ...esmVars(tree) },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export the construct through the harnesses app index and the shared
  // app index. addStarExport creates a missing index file and semantically
  // deduplicates equivalent exports on reruns.
  await addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'harnesses',
      'index.ts',
    ),
    `./${templateContext.nameKebabCase}/${templateContext.nameKebabCase}.js`,
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
    './harnesses/index.js',
  );
};

const addAgentCoreHarnessTerraformInfra = (
  tree: Tree,
  templateContext: HarnessTemplateContext,
) => {
  // Generate the app specific Terraform module under
  // src/app/harnesses/<kebab-case-name>/. No CDK files or exports are
  // created on this path.
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      'terraform',
      'app',
      'agentcore-harness',
    ),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'app',
      'harnesses',
    ),
    { ...templateContext, ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
