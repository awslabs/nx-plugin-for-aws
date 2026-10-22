/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Iac } from '../iac.js';
import { snakeCase } from '../names.js';
import { SHARED_CONSTRUCTS_NAME } from '../shared-constructs-constants.js';

export interface GuardrailWiringOptions {
  iac: Iac;
  /** Class name of the guarded agent, eg `MyAgent`. */
  nameClassName: string;
  /** Kebab-case name of the guarded agent, eg `my-agent`. */
  nameKebabCase: string;
  /** npm scope of the workspace without the `@`, eg `my-scope`. */
  npmScope: string;
}

/** The ts#agent guide section that shows how to deploy the agent's Terraform module. */
export const TS_AGENT_TERRAFORM_DEPLOY_GUIDE_URL =
  'https://awslabs.github.io/nx-plugin-for-aws/en/guides/ts-agent/#infrastructure-as-code';

/**
 * The code a user adds to their CDK stack to guard the agent.
 * The guide shows the same code for `my-agent` in scope `my-scope`, which
 * generator.spec.ts checks.
 */
export const cdkGuardrailWiring = ({
  nameClassName,
  npmScope,
}: Pick<GuardrailWiringOptions, 'nameClassName' | 'npmScope'>): string =>
  `import { ${nameClassName}, ${nameClassName}Guardrail } from '@${npmScope}/${SHARED_CONSTRUCTS_NAME}';

const agent = new ${nameClassName}(this, '${nameClassName}');
new ${nameClassName}Guardrail(this, '${nameClassName}Guardrail', { agent });`;

/**
 * The code a user adds to their root Terraform module to grant the agent the
 * guardrail and deploy its runtime-config entry, relative to
 * `packages/infra/src`. The guide shows the same code for `my-agent`, which
 * generator.spec.ts checks.
 */
export const terraformGuardrailWiring = ({
  nameKebabCase,
}: Pick<GuardrailWiringOptions, 'nameKebabCase'>): string => {
  const agentModule = snakeCase(nameKebabCase);
  const guardrailModule = `${agentModule}_guardrail`;
  return `module "${guardrailModule}" {
  source = "../../common/terraform/src/app/guardrails/${nameKebabCase}"
}

module "${agentModule}" {
  source = "../../common/terraform/src/app/agents/${nameKebabCase}"
  # ...existing arguments...
  additional_iam_policy_statements = module.${guardrailModule}.iam_policy_statements
}

module "runtime_config_appconfig_deployment" {
  # ...existing arguments...
  depends_on = [
    # ...existing modules...
    module.${guardrailModule},
  ]
}`;
};

/**
 * How to add the printed Terraform code. `ts#agent` does not add the agent to
 * the root module, so its `module` block may not exist yet.
 */
const terraformSteps = (nameKebabCase: string): string => {
  const agentModule = snakeCase(nameKebabCase);
  return `Add the module "${agentModule}_guardrail" block as printed below. Add its additional_iam_policy_statements line to your existing module "${agentModule}" block, and add module.${agentModule}_guardrail to the depends_on list of your runtime_config_appconfig_deployment module. If your root module does not deploy the agent yet, add the agent's module first, as described in ${TS_AGENT_TERRAFORM_DEPLOY_GUIDE_URL}.`;
};

/**
 * The message the generator prints after it adds the guardrail
 * infrastructure. The generator does not edit the user's stack or root
 * module, so this tells the user what to add there.
 */
export const guardrailWiringMessage = (
  options: GuardrailWiringOptions,
): string => {
  const missing = `Until you add it, the deployed agent fails on its first request, because runtime config has no guardrail at agentcore.guardrails.${options.nameClassName}.`;
  return options.iac === 'cdk'
    ? `Add the guardrail to your agent in your stack, for example packages/infra/src/stacks/application-stack.ts. ${missing}

${cdkGuardrailWiring(options)}`
    : `Add the guardrail to your agent in the root Terraform module where you deploy the agent, for example packages/infra/src/main.tf. ${missing} ${terraformSteps(options.nameKebabCase)}

${terraformGuardrailWiring(options)}`;
};
