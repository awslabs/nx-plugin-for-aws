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
  updateJson,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';
import { addStarExport } from '../ast';
import { withVersions } from '../versions';
import { IacProvider } from '../iac';

type IACProvider = { iacProvider: IacProvider };

export interface AddAgentCoreInfraProps {
  nameClassName: string;
  nameKebabCase: string;
  projectName: string;
  dockerImageTag: string;
  appDirectory: string;
  serverProtocol: 'MCP' | 'HTTP';
}

const addAgentCoreInfra = (
  tree: Tree,
  options: AddAgentCoreInfraProps & { iacProvider: IacProvider },
) => {
  switch (options.iacProvider) {
    case 'CDK':
      addAgentCoreCDKInfra(tree, options);
      break;
    case 'Terraform':
      addAgentCoreTerraformInfra(tree, options);
      break;
  }

  // Update shared constructs/terraform project configuration to depend on this project
  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iacProvider === 'CDK'
        ? SHARED_CONSTRUCTS_DIR
        : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      if (!config.targets) {
        config.targets = {};
      }
      if (!config.targets.build) {
        config.targets.build = {};
      }
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []).filter(
          (t) => t !== `${options.projectName}:build`,
        ),
        `${options.projectName}:build`,
      ];
      return config;
    },
  );
};

const addAgentCoreCDKInfra = (tree: Tree, options: AddAgentCoreInfraProps) => {
  // Construct uses bedrock agentcore types
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(['@aws-sdk/client-bedrock-agentcore-control']),
  );

  // Add the AgentCore runtime construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'core', 'agent-core'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'agent-core',
    ),
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

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
  addStarExport(
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
  addStarExport(
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
    {},
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
}

/**
 * Add an MCP server CDK construct
 */
export const addMcpServerInfra = (
  tree: Tree,
  options: AddMcpServerInfraProps & IACProvider,
) => {
  addAgentCoreInfra(tree, {
    nameClassName: options.mcpServerNameClassName,
    nameKebabCase: options.mcpServerNameKebabCase,
    dockerImageTag: options.dockerImageTag,
    projectName: options.projectName,
    appDirectory: 'mcp-servers',
    serverProtocol: 'MCP',
    iacProvider: options.iacProvider,
  });
};

export interface AddAgentInfraProps {
  agentNameClassName: string;
  agentNameKebabCase: string;
  projectName: string;
  dockerImageTag: string;
}

/**
 * Add an MCP server CDK construct
 */
export const addAgentInfra = (
  tree: Tree,
  options: AddAgentInfraProps & IACProvider,
) => {
  addAgentCoreInfra(tree, {
    nameClassName: options.agentNameClassName,
    nameKebabCase: options.agentNameKebabCase,
    projectName: options.projectName,
    dockerImageTag: options.dockerImageTag,
    appDirectory: 'agents',
    serverProtocol: 'HTTP',
    iacProvider: options.iacProvider,
  });
};
