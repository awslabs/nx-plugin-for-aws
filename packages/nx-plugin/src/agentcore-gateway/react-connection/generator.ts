/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, logger, type Tree } from '@nx/devkit';
import { addGatewayTargetToLocalDev } from '../../connection/agent-local-dev';
import { addGatewayUrlToConnectionNamespace } from '../../connection/gateway-runtime-config';
import { PY_AGENT_GENERATOR_INFO } from '../../py/agent/generator';
import { pyAgentReactConnectionGenerator } from '../../py/agent/react-connection/generator';
import { TS_AGENT_GENERATOR_INFO } from '../../ts/agent/generator';
import { tsAgentReactConnectionGenerator } from '../../ts/agent/react-connection/generator';
import { formatFilesInSubtree } from '../../utils/format';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase } from '../../utils/names';
import {
  addComponentGeneratorMetadata,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { AGENTCORE_GATEWAY_AGENT_CONNECTION_GENERATOR_INFO } from '../agent-connection/generator';
import { readAgentCoreGatewayMetadata } from '../generator';
import type { AgentcoreGatewayReactConnectionGeneratorSchema } from './schema';

export const AGENTCORE_GATEWAY_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/** An agent fronted by the gateway, resolved from its connection metadata. */
interface FrontedAgent {
  readonly projectName: string;
  readonly component: ComponentMetadata;
  readonly targetName: string;
  readonly language: 'ts' | 'py';
}

/**
 * Connect a React website to an AgentCore Gateway fronting agents.
 *
 * For each agent attached to the gateway (via the
 * `agentcore-gateway#agent-connection` generator), generates the same website
 * client as connecting to the agent directly, but routed through the
 * gateway's `/<targetName>` path — so the browser only needs to reach the
 * gateway, and the agent runtimes can sit in a VPC behind it.
 */
export const agentcoreGatewayReactConnectionGenerator = async (
  tree: Tree,
  options: AgentcoreGatewayReactConnectionGeneratorSchema,
) => {
  const frontendProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const gatewayProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );
  const gateway = readAgentCoreGatewayMetadata(gatewayProject);

  if (gateway.protocol !== 'http') {
    throw new Error(
      `Gateway '${gateway.name}' has protocol='${gateway.protocol}'. Websites can only connect to http-protocol gateways, which proxy requests to their agent targets.`,
    );
  }

  // A2A targets speak agent-to-agent JSON-RPC, not a browser protocol, so
  // the website only connects to the gateway's AG-UI / HTTP agents. A gateway
  // with none attached yet still gets its URL published and dev wiring —
  // re-running this connection after attaching agents generates their
  // website clients.
  const agents = frontedAgents(tree, gatewayProject.name).filter(
    (agent) =>
      ((agent.component.protocol as string) ?? '').toLowerCase() !== 'a2a',
  );
  if (agents.length === 0) {
    logger.warn(
      `Gateway '${gateway.name}' has no AG-UI or HTTP agents attached, so no website clients were generated. Connect agents to the gateway, then re-run this connection to generate their clients.`,
    );
  }

  // One website client per fronted agent, routed through the gateway.
  for (const agent of agents) {
    const generator =
      agent.language === 'ts'
        ? tsAgentReactConnectionGenerator
        : pyAgentReactConnectionGenerator;
    await generator(tree, {
      sourceProject: frontendProject.name,
      targetProject: agent.projectName,
      targetComponent: agent.component,
      preferInstallDependencies: options.preferInstallDependencies,
      gatewayRoute: {
        gatewayClassName: gateway.rc,
        targetName: agent.targetName,
        gatewayAuth: gateway.auth,
      },
    });
  }

  // Publish the gateway URL to the website via the 'connection' namespace.
  await addGatewayUrlToConnectionNamespace(tree, {
    gatewayNameKebabCase: kebabCase(gateway.rc),
    gatewayNameClassName: gateway.rc,
  });

  // Wire the website's dev target to the local gateway, which proxies to the
  // attached agents (transitively starting them via its own dev dependencies).
  await addGatewayTargetToLocalDev(
    tree,
    frontendProject.name,
    gatewayProject.name,
    {
      gatewayClassName: gateway.rc,
      port: gateway.port,
    },
  );

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    frontendProject.name,
    AGENTCORE_GATEWAY_REACT_CONNECTION_GENERATOR_INFO,
    gatewayProject.root,
    gateway.rc,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_REACT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

/**
 * The agents attached to the gateway, resolved from the connection entries
 * the `agentcore-gateway#agent-connection` generator recorded: each names the
 * agent project by root (`path`) and its gateway target name (`name`), which
 * matches the agent component's class name in kebab-case.
 */
const frontedAgents = (
  tree: Tree,
  gatewayProjectName: string,
): FrontedAgent[] => {
  const gatewayProject = readProjectConfigurationUnqualified(
    tree,
    gatewayProjectName,
  );
  const connections = (
    ((gatewayProject.metadata as any)?.components ?? []) as ComponentMetadata[]
  ).filter(
    (c) => c.generator === AGENTCORE_GATEWAY_AGENT_CONNECTION_GENERATOR_INFO.id,
  );

  const projectsByRoot = new Map(
    [...getProjects(tree).values()].map((p) => [p.root, p]),
  );

  return connections.flatMap((connection) => {
    const agentProject = connection.path
      ? projectsByRoot.get(connection.path)
      : undefined;
    if (!agentProject) {
      return [];
    }
    const component = (
      ((agentProject.metadata as any)?.components ?? []) as ComponentMetadata[]
    ).find(
      (c) =>
        [TS_AGENT_GENERATOR_INFO.id, PY_AGENT_GENERATOR_INFO.id].includes(
          c.generator,
        ) && kebabCase((c.rc as string) ?? '') === connection.name,
    );
    if (!component) {
      return [];
    }
    return [
      {
        projectName: agentProject.name,
        component,
        targetName: connection.name,
        language: (component.generator === TS_AGENT_GENERATOR_INFO.id
          ? 'ts'
          : 'py') as 'ts' | 'py',
      },
    ];
  });
};

export default agentcoreGatewayReactConnectionGenerator;
