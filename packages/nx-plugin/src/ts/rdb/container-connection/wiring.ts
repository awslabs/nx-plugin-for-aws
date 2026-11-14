/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  camelCase,
  kebabCase,
  snakeCase,
  toClassName,
} from '../../../utils/names.js';
import type { ContainerServiceNames } from '../../container/react-connection/container-connection.js';
import { terraformRolePolicy } from '../../container/react-connection/container-connection.js';

export interface DataStoreNames {
  /** PascalCase: the data construct's class, eg `MyDatabase`. */
  readonly className: string;
  /** kebab-case, eg `my-database`. */
  readonly kebabCase: string;
  /** snake_case: the Terraform module label, eg `my_database`. */
  readonly moduleName: string;
  /** camelCase: the construct's variable in printed CDK code, eg `myDatabase`. */
  readonly variableName: string;
}

/** The names of a data store project (`ts#rdb`, `py#dynamodb`, ...). */
export const dataStoreNames = (projectName: string): DataStoreNames => {
  const baseName =
    projectName.split('/').pop()?.split('.').pop() ?? projectName;
  const className = toClassName(baseName);
  const kebab = kebabCase(className);
  return {
    className,
    kebabCase: kebab,
    moduleName: snakeCase(kebab),
    variableName: camelCase(className),
  };
};

export type ServiceWiringNames = Pick<
  ContainerServiceNames,
  'nameClassName' | 'nameKebabCase' | 'moduleName' | 'variableName'
>;

/**
 * The code a user adds to their CDK stack so the service may connect to the
 * database. The guides show it for `MyService` and `MyDatabase`, which the
 * specs check.
 */
export const cdkRdbContainerWiring = (
  service: ServiceWiringNames,
  db: DataStoreNames,
): string => `${db.variableName}.allowDefaultPortFrom(${service.variableName});
${db.variableName}.grantConnect(${service.variableName}.taskRole);`;

const securityGroupRule = (
  direction: 'ingress' | 'egress',
  service: ServiceWiringNames,
  db: DataStoreNames,
) => {
  const [own, referenced] =
    direction === 'ingress'
      ? [db.moduleName, service.moduleName]
      : [service.moduleName, db.moduleName];
  const description =
    direction === 'ingress'
      ? `Allow the ${service.nameKebabCase} container service to connect to the database`
      : `Allow the ${service.nameKebabCase} container service to reach the database`;
  return `resource "aws_vpc_security_group_${direction}_rule" "${service.moduleName}_to_${db.moduleName}" {
  description                  = "${description}"
  security_group_id            = module.${own}.security_group_id
  referenced_security_group_id = module.${referenced}.security_group_id
  from_port                    = module.${db.moduleName}.cluster_port
  to_port                      = module.${db.moduleName}.cluster_port
  ip_protocol                  = "tcp"
}`;
};

/**
 * The same access for the root Terraform module: `rds-db:connect` on the task
 * role, and the security group rule pair on the database port.
 */
export const terraformRdbContainerWiring = (
  service: ServiceWiringNames,
  db: DataStoreNames,
): string => `${terraformRolePolicy({
  label: `${service.moduleName}_${db.moduleName}_connect`,
  role: `module.${service.moduleName}.task_role_name`,
  statements: [
    `{
  Effect   = "Allow"
  Action   = ["rds-db:connect"]
  Resource = ["arn:aws:rds-db:\${data.aws_region.current.region}:\${data.aws_caller_identity.current.account_id}:dbuser:\${module.${db.moduleName}.connect_resource_id}/\${module.${db.moduleName}.database_runtime_user}"]
},`,
  ],
})}

${securityGroupRule('ingress', service, db)}

${securityGroupRule('egress', service, db)}`;

/**
 * What the rdb connection generators print. They do not edit the user's stack
 * or root module, so this tells the user what to add there.
 */
export const rdbContainerWiringMessage = (
  service: ServiceWiringNames & { iac?: string },
  db: DataStoreNames,
): string => {
  const intro = `Let the ${service.nameClassName} container service connect to the ${db.className} database.`;
  const missing = `Until you add it, the service cannot reach the database port and its IAM authentication is refused.`;
  return service.iac === 'terraform'
    ? `${intro} Add this to the root Terraform module that deploys both, for example packages/infra/src/main.tf, where module "${service.moduleName}" deploys the service and module "${db.moduleName}" deploys the database. ${missing}

${terraformRdbContainerWiring(service, db)}`
    : `${intro} Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where ${service.variableName} is your ${service.nameClassName} construct and ${db.variableName} is your ${db.className} construct. ${missing}

${cdkRdbContainerWiring(service, db)}`;
};
