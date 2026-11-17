/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type ProjectConfiguration } from '@nx/devkit';
import { camelCase, kebabCase, snakeCase } from '../utils/names.js';
import type { ComponentMetadata } from '../utils/nx.js';
import {
  CONNECTION_CONSTRAINTS,
  type ConnectionConstraint,
} from './scaffold-catalog.js';

/** The generators whose components are container services. */
export const CONTAINER_GENERATOR_IDS = ['ts#container', 'py#container'];

/**
 * The container component a connection reaches or starts from: the one given,
 * or else the only container component on the project.
 */
export const resolveContainerComponent = (
  project: ProjectConfiguration,
  component: ComponentMetadata | undefined,
  side: 'source' | 'target',
): ComponentMetadata => {
  if (component) {
    return component;
  }
  const components =
    (project.metadata as { components?: ComponentMetadata[] } | undefined)
      ?.components ?? [];
  const containers = components.filter((c) =>
    CONTAINER_GENERATOR_IDS.includes(c.generator),
  );
  if (containers.length === 0) {
    throw new Error(
      `Project ${project.name} has no ts#container or py#container component to connect ${side === 'target' ? 'to' : 'from'}.`,
    );
  }
  if (containers.length > 1) {
    throw new Error(
      `Project ${project.name} has several container components (${containers.map((c) => c.name).join(', ')}). Choose one with ${side}Component.`,
    );
  }
  return containers[0];
};

const holds = (
  value: unknown,
  constraint: Pick<ConnectionConstraint, 'equals' | 'notEquals'>,
): boolean =>
  value !== undefined &&
  (constraint.equals === undefined || value === constraint.equals) &&
  (constraint.notEquals === undefined || value !== constraint.notEquals);

/**
 * Throws with the catalog's reason when an endpoint breaks one of the
 * `CONNECTION_CONSTRAINTS` entries for `key`, so the guard and the catalog
 * cannot disagree. A missing option value is a violation.
 */
export const assertContainerConnectionConstraints = (
  key: string,
  endpoints: {
    source?: Record<string, unknown>;
    target?: Record<string, unknown>;
  },
  labels?: { source: string; target: string },
): void => {
  const constraints =
    (CONNECTION_CONSTRAINTS as Record<string, readonly ConnectionConstraint[]>)[
      key
    ] ?? [];
  const [sourceType, targetType] = key.split(' -> ');
  for (const constraint of constraints) {
    if (
      constraint.when &&
      endpoints[constraint.when.side]?.[constraint.when.option] !==
        constraint.when.equals
    ) {
      continue;
    }
    if (!holds(endpoints[constraint.side]?.[constraint.option], constraint)) {
      throw new Error(
        `Cannot connect ${labels?.source ?? sourceType} to ${labels?.target ?? targetType}: ${constraint.reason}`,
      );
    }
  }
};

/** The names a container connection derives from the service's component. */
export interface ContainerServiceNames {
  /** PascalCase: construct class and runtime-config key, eg `MyService`. */
  readonly nameClassName: string;
  /** kebab-case: file and Terraform module folder names, eg `my-service`. */
  readonly nameKebabCase: string;
  /** snake_case: Terraform module labels and Python names, eg `my_service`. */
  readonly moduleName: string;
  /** camelCase: the construct's variable in printed CDK code, eg `myService`. */
  readonly variableName: string;
  /** Target prefix, eg `my-service` for `my-service-serve`. */
  readonly prefix: string;
  /** Local `serve` port. */
  readonly port: number;
  readonly iac?: string;
  /** Workspace-relative folder holding the service's code and Dockerfile. */
  readonly sourceDir: string;
}

export const containerServiceNames = (
  project: Pick<ProjectConfiguration, 'root'>,
  component: ComponentMetadata,
): ContainerServiceNames => {
  const nameClassName = component.rc as string;
  const nameKebabCase = kebabCase(nameClassName);
  return {
    nameClassName,
    nameKebabCase,
    moduleName: snakeCase(nameKebabCase),
    variableName: camelCase(nameClassName),
    prefix: component.name ?? 'service',
    port: component.port,
    iac: component.iac,
    sourceDir: joinPathFragments(project.root, component.path ?? ''),
  };
};

/**
 * An IAM statement allowing `execute-api:Invoke` on every route of the
 * service's HTTP API, from the Terraform module's `api_execution_arn` output.
 */
export const executeApiInvokeStatement = (moduleName: string): string => `{
  Effect   = "Allow"
  Action   = ["execute-api:Invoke"]
  Resource = ["\${module.${moduleName}.api_execution_arn}/*"]
},`;

const indent = (text: string, spaces: number) =>
  text
    .split('\n')
    .map((line) => (line ? `${' '.repeat(spaces)}${line}` : line))
    .join('\n');

/**
 * An `aws_iam_role_policy` holding the given statements, each an HCL object
 * followed by a comma. The policy name is the label in kebab-case.
 */
export const terraformRolePolicy = ({
  label,
  role,
  statements,
}: {
  label: string;
  role: string;
  statements: string[];
}): string => `resource "aws_iam_role_policy" "${label}" {
  name = "${label.replace(/_/g, '-')}"
  role = ${role}

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
${statements.map((s) => indent(s, 6)).join('\n')}
    ]
  })
}`;
