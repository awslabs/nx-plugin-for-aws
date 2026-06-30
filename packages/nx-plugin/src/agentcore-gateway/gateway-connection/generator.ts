/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeneratorCallback, Tree } from '@nx/devkit';
import { formatFilesInSubtree } from '../../utils/format';
import { installDeps } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase } from '../../utils/names';
import {
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { attachUpstreamToLocalGateway } from '../attach-upstream';
import {
  AGENTCORE_GATEWAY_GENERATOR_INFO,
  readAgentCoreGatewayMetadata,
} from '../generator';
import type { AgentcoreGatewayGatewayConnectionGeneratorSchema } from './schema';

export const AGENTCORE_GATEWAY_GATEWAY_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect an AgentCore Gateway to another AgentCore Gateway.
 *
 * Chains the source gateway's dev target to the target gateway's
 * dev target, and registers the target gateway in the source
 * gateway's local local-dev.ts so the local gateway aggregates its tools
 * (already prefixed by the target gateway) under
 * `<targetGateway>___<targetName>___<toolName>`. Users must still call
 * `gateway.addGateway(...)` in their application stack to create the
 * actual CDK/Terraform resource.
 */
export const agentcoreGatewayGatewayConnectionGenerator = async (
  tree: Tree,
  options: AgentcoreGatewayGatewayConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const sourceGateway = readAgentCoreGatewayMetadata(sourceProject);
  const targetGateway = readAgentCoreGatewayMetadata(targetProject);

  if (sourceProject.name === targetProject.name) {
    throw new Error(
      `Cannot connect gateway '${sourceGateway.name}' to itself.`,
    );
  }

  for (const gateway of [sourceGateway, targetGateway]) {
    if (gateway.protocol !== 'mcp') {
      throw new Error(
        `Gateway '${gateway.name}' has protocol='${gateway.protocol}'. Gateway->Gateway connections are only supported between MCP-protocol gateways.`,
      );
    }
  }

  // The source gateway invokes the target signing with its own IAM role, so
  // only the target's inbound auth must be IAM. The source's inbound auth (how
  // its own callers reach it) is irrelevant to this hop.
  if (targetGateway.auth !== 'iam') {
    throw new Error(
      `Gateway '${targetGateway.name}' uses auth='${targetGateway.auth}'. Gateway->Gateway connections currently require the target gateway to use IAM authentication.`,
    );
  }

  assertNoCycle(tree, sourceProject.name, targetProject.name);

  // The target name must match the deployed Gateway target (`gatewayName` on
  // the gateway construct, the project's class name in kebab-case) so
  // `<targetGateway>___<target>___<tool>` resolves identically locally and
  // deployed.
  const targetGatewayKebabCase = kebabCase(targetGateway.rc);

  await attachUpstreamToLocalGateway(tree, sourceProject, 'dev', {
    targetName: targetGatewayKebabCase,
    port: targetGateway.port,
    upstreamProjectName: targetProject.name,
    upstreamDevTargetName: 'dev',
  });

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_GATEWAY_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  return () => installDeps(tree, options.preferInstallDependencies, {
    languages: ['typescript'],
  });
};

/**
 * Reject connections that would make the local gateway graph cyclic — a
 * cycle would recurse infinitely on tools/list both locally and deployed.
 *
 * Walks gateway dev dependsOn edges from the target gateway; the
 * source gateway must not be reachable.
 */
const assertNoCycle = (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
) => {
  const visited = new Set<string>();
  const stack = [targetProjectName];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === sourceProjectName) {
      throw new Error(
        `Connecting '${sourceProjectName}' to '${targetProjectName}' would create a cycle: '${targetProjectName}' already routes to '${sourceProjectName}'.`,
      );
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const project = readProjectConfigurationUnqualified(tree, current);
    if (
      (project.metadata as any)?.generator !==
      AGENTCORE_GATEWAY_GENERATOR_INFO.id
    ) {
      continue;
    }
    readAgentCoreGatewayMetadata(project);
    const devTarget = project.targets?.['dev'];
    for (const dep of devTarget?.dependsOn ?? []) {
      if (typeof dep !== 'string') {
        stack.push(...(dep.projects ?? []));
      }
    }
  }
};

export default agentcoreGatewayGatewayConnectionGenerator;
