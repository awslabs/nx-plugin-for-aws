/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { addStarExport } from '../ast';
import type { Containers } from '../containers';
import type { Iac } from '../iac';
import { addDependencyToTargetIfNotPresent } from '../nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import { withVersions } from '../versions';

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
    joinPathFragments(__dirname, 'files', 'cdk', 'app', 'agent-core'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      options.appDirectory,
    ),
    options,
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
    joinPathFragments(__dirname, 'files', 'terraform', 'core', 'agent-core'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_TERRAFORM_DIR,
      'src',
      'core',
      'agent-core',
    ),
    { containers: options.containers },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate app specific agent core configuration
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'terraform', 'app', 'agent-core'),
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
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@aws-cdk/aws-bedrock-agentcore-alpha']),
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'app', 'agentcore-gateway'),
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
};

const addAgentCoreGatewayTerraformInfra = (
  tree: Tree,
  options: AddAgentCoreGatewayInfraProps,
) => {
  generateFiles(
    tree,
    joinPathFragments(
      __dirname,
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
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(
      __dirname,
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
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
