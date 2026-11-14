/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ContainerServiceNames } from './container-connection.js';
import {
  executeApiInvokeStatement,
  terraformRolePolicy,
} from './container-connection.js';

type Names = Pick<
  ContainerServiceNames,
  'nameClassName' | 'moduleName' | 'variableName'
>;

/**
 * The code a user adds to their CDK stack so signed-in website users may call
 * an `iam` service. The guide shows it for `MyService`, which
 * generator.spec.ts checks.
 */
export const cdkReactContainerWiring = ({ variableName }: Names): string =>
  `${variableName}.grantInvoke(identity.identityPool.authenticatedRole);`;

/**
 * The same grant for the root Terraform module, on the identity pool's
 * authenticated role.
 */
export const terraformReactContainerWiring = ({ moduleName }: Names): string =>
  terraformRolePolicy({
    label: `authenticated_${moduleName}_invoke`,
    role: 'module.user_identity.authenticated_role_name',
    statements: [executeApiInvokeStatement(moduleName)],
  });

/**
 * What the generator prints for an `iam` service. It does not edit the user's
 * stack or root module, so this tells the user what to add there.
 */
export const reactContainerWiringMessage = (
  names: Names & { iac?: string },
): string => {
  const intro = `Let signed-in users of your website call the ${names.nameClassName} container service.`;
  const missing = `Until you add it, the service's HTTP API rejects the website's requests with 403 Forbidden.`;
  return names.iac === 'terraform'
    ? `${intro} Add this to the root Terraform module that deploys the service, for example packages/infra/src/main.tf, where module "${names.moduleName}" deploys the service and module "user_identity" deploys your website's identity pool. ${missing}

${terraformReactContainerWiring(names)}`
    : `${intro} Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where ${names.variableName} is your ${names.nameClassName} construct and identity is your UserIdentity construct. ${missing}

${cdkReactContainerWiring(names)}`;
};
