/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { camelCase, kebabCase, snakeCase } from '../../../utils/names.js';
import type { ContainerServiceNames } from '../../container/react-connection/container-connection.js';
import { executeApiInvokeStatement } from '../../container/react-connection/container-connection.js';

export interface AgentContainerWiringNames
  extends Pick<
    ContainerServiceNames,
    'nameClassName' | 'moduleName' | 'variableName'
  > {
  /** Class name of the calling agent, eg `MyAgent`. */
  agentClassName: string;
}

/**
 * The code a user adds to their CDK stack so the agent may call the service.
 * The guides show it for `MyAgent` and `MyService`, which the specs check.
 */
export const cdkAgentContainerWiring = ({
  variableName,
  agentClassName,
}: AgentContainerWiringNames): string =>
  `${variableName}.grantInvoke(${camelCase(agentClassName)});`;

/**
 * The same grant for the root Terraform module, added to the agent module's
 * role through `additional_iam_policy_statements`.
 */
export const terraformAgentContainerWiring = ({
  moduleName,
  agentClassName,
}: AgentContainerWiringNames): string => {
  const agentKebabCase = kebabCase(agentClassName);
  const statement = executeApiInvokeStatement(moduleName)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return `module "${snakeCase(agentKebabCase)}" {
  source = "../../common/terraform/src/app/agents/${agentKebabCase}"
  # ...existing arguments...
  additional_iam_policy_statements = [
${statement}
  ]
}`;
};

/**
 * What the agent connection generators print. They do not edit the user's
 * stack or root module, so this tells the user what to add there.
 */
export const agentContainerWiringMessage = (
  names: AgentContainerWiringNames & { iac?: string },
): string => {
  const intro = `Let the ${names.agentClassName} agent call the ${names.nameClassName} container service.`;
  const missing = `Until you add it, the service's HTTP API rejects the agent's requests with 403 Forbidden.`;
  return names.iac === 'terraform'
    ? `${intro} Add the additional_iam_policy_statements entry below to the agent's module block in the root Terraform module, for example packages/infra/src/main.tf, where module "${names.moduleName}" deploys the service. Merge it with any statements the block already lists. ${missing}

${terraformAgentContainerWiring(names)}`
    : `${intro} Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where ${names.variableName} is your ${names.nameClassName} construct and ${camelCase(names.agentClassName)} is your ${names.agentClassName} construct. ${missing}

${cdkAgentContainerWiring(names)}`;
};
