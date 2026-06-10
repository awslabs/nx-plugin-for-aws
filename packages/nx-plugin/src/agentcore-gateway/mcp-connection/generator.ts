/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  installPackagesTask,
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase } from '../../utils/names';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import type { AgentcoreGatewayMcpConnectionGeneratorSchema } from './schema';

export const AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

/**
 * Connect an AgentCore Gateway to an MCP server.
 *
 * Chains the gateway's serve-local target to the MCP server's serve-local
 * target, and registers the server in the gateway's local serve.ts so the
 * local gateway aggregates its tools.
 *
 * Users must still call `gateway.addMcpServer(...)` in their application
 * stack to create the actual CDK/Terraform resource. The generator logs
 * instructions on completion.
 */
export const agentcoreGatewayMcpConnectionGenerator = async (
  tree: Tree,
  options: AgentcoreGatewayMcpConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const gatewayComponent = options.sourceComponent;
  const mcpComponent = options.targetComponent;

  if (!gatewayComponent) {
    throw new Error(
      `Source project '${options.sourceProject}' has no AgentCore Gateway component metadata. Did you run the 'agentcore-gateway' generator?`,
    );
  }
  if (!mcpComponent) {
    throw new Error(
      `Target project '${options.targetProject}' has no MCP server component metadata. Did you run the 'ts#mcp-server' or 'py#mcp-server' generator?`,
    );
  }

  if (gatewayComponent.protocol !== 'mcp') {
    throw new Error(
      `Gateway '${gatewayComponent.name}' has protocol='${gatewayComponent.protocol}'. MCP server targets can only be attached to MCP-protocol gateways.`,
    );
  }
  if (mcpComponent.auth && mcpComponent.auth !== 'iam') {
    throw new Error(
      `MCP server '${mcpComponent.name}' uses auth='${mcpComponent.auth}'. Gateway->MCP connections currently require the MCP server to use IAM authentication.`,
    );
  }

  const gatewayClassName = gatewayComponent.rc as string;
  const gatewayKebabCase = kebabCase(gatewayClassName);
  const gatewayServeLocalTargetName = `${gatewayKebabCase}-serve-local`;

  const mcpClassName = mcpComponent.rc as string;
  const mcpComponentName = mcpComponent.name ?? 'mcp-server';
  const mcpServeLocalTargetName = `${mcpComponentName}-serve-local`;
  const mcpPort = (mcpComponent.port as number | undefined) ?? 8000;

  // 1. Wire serve-local chain
  if (sourceProject.targets?.[gatewayServeLocalTargetName]) {
    addDependencyToTargetIfNotPresent(
      sourceProject,
      gatewayServeLocalTargetName,
      {
        projects: [targetProject.name],
        target: mcpServeLocalTargetName,
      },
    );
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // 2. Register the MCP server in the gateway's local serve.ts
  const serveTsPath = joinPathFragments(sourceProject.root, 'serve.ts');
  if (tree.exists(serveTsPath)) {
    const content = tree.read(serveTsPath)!.toString();
    if (!content.includes(`'${mcpComponentName}'`)) {
      const entry = `  { name: '${mcpComponentName}', url: 'http://localhost:${mcpPort}/mcp' },`;
      const updated = content.replace(
        /(const ATTACHED_MCP_SERVERS = \[)([\s\S]*?)(\];)/m,
        (_match, open, inner, close) =>
          `${open}${inner.replace(/\s+$/, '')}\n${entry}\n${close}`,
      );
      if (updated !== content) tree.write(serveTsPath, updated);
    }
  }

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  // Print instructions for the user to add the CDK/TF wiring in their stack.
  // This is the one step we can't automate because the generator doesn't
  // know which stack the user will instantiate the gateway in.
  const mcpVarName =
    mcpClassName.charAt(0).toLowerCase() + mcpClassName.slice(1);
  const gatewayVarName =
    gatewayClassName.charAt(0).toLowerCase() + gatewayClassName.slice(1);
  console.log('');
  console.log(
    `✔ Connected ${mcpClassName} MCP server to ${gatewayClassName} gateway.`,
  );
  console.log('');
  console.log('Add the following to the stack that instantiates your gateway:');
  console.log('');
  console.log(
    `  const ${mcpVarName} = new ${mcpClassName}(this, '${mcpClassName}');`,
  );
  console.log(`  ${gatewayVarName}.addMcpServer(${mcpVarName});`);
  console.log('');

  return () => {
    installPackagesTask(tree);
  };
};

export default agentcoreGatewayMcpConnectionGenerator;
