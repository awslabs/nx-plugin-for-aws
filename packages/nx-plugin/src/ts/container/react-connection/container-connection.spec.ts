/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProjectConfiguration } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { CONNECTION_CONSTRAINTS } from '../../../connection/scaffold-catalog.js';
import {
  assertContainerConnectionConstraints,
  containerServiceNames,
  resolveContainerComponent,
  terraformRolePolicy,
} from './container-connection.js';

const container = (overrides: Record<string, unknown> = {}) => ({
  generator: 'ts#container',
  name: 'orders',
  path: 'src/orders',
  port: 8083,
  rc: 'Orders',
  infra: 'ecs',
  ingress: 'http-api',
  auth: 'iam',
  iac: 'cdk',
  ...overrides,
});

const reasonOf = (key: string, option: string) =>
  (
    CONNECTION_CONSTRAINTS as Record<
      string,
      readonly { option: string; reason: string }[]
    >
  )[key].find((c) => c.option === option)?.reason as string;

describe('assertContainerConnectionConstraints', () => {
  describe('caller to container', () => {
    const key = 'ts#react-website -> ts#container';

    it('accepts an ecs service behind an HTTP API', () => {
      expect(() =>
        assertContainerConnectionConstraints(key, { target: container() }),
      ).not.toThrow();
    });

    it.each([
      ['infra', { infra: 'none', ingress: undefined, auth: undefined }],
      ['ingress', { ingress: 'private', auth: undefined }],
    ])('rejects a service whose %s breaks the catalog', (option, values) => {
      expect(() =>
        assertContainerConnectionConstraints(key, {
          target: container(values),
        }),
      ).toThrow(reasonOf(key, option));
    });

    it('treats a missing ingress as a violation', () => {
      expect(() =>
        assertContainerConnectionConstraints(key, {
          target: container({ ingress: undefined }),
        }),
      ).toThrow(reasonOf(key, 'ingress'));
    });

    it('names both ends in the message', () => {
      expect(() =>
        assertContainerConnectionConstraints(
          key,
          { target: container({ ingress: 'private' }) },
          { source: 'website', target: 'svc (orders)' },
        ),
      ).toThrow(/^Cannot connect website to svc \(orders\): /);
    });
  });

  describe('agent to container', () => {
    const key = 'py#agent -> py#container';

    it('accepts an IAM service', () => {
      expect(() =>
        assertContainerConnectionConstraints(key, {
          target: container({ generator: 'py#container' }),
        }),
      ).not.toThrow();
    });

    it.each(['cognito', 'none'])('rejects a service with %s auth', (auth) => {
      expect(() =>
        assertContainerConnectionConstraints(key, {
          target: container({ generator: 'py#container', auth }),
        }),
      ).toThrow(reasonOf(key, 'auth'));
    });
  });

  describe('container to data', () => {
    const key = 'ts#container -> ts#rdb';

    it('accepts an ecs service', () => {
      expect(() =>
        assertContainerConnectionConstraints(key, { source: container() }),
      ).not.toThrow();
    });

    it('rejects a service with no infrastructure', () => {
      expect(() =>
        assertContainerConnectionConstraints(key, {
          source: container({ infra: 'none' }),
        }),
      ).toThrow(reasonOf(key, 'infra'));
    });
  });

  it('accepts a connection the catalog does not constrain', () => {
    expect(() =>
      assertContainerConnectionConstraints('ts#react-website -> ts#trpc-api', {
        target: {},
      }),
    ).not.toThrow();
  });
});

describe('resolveContainerComponent', () => {
  const project = (components: unknown[]): ProjectConfiguration => ({
    name: 'svc',
    root: 'packages/svc',
    metadata: { components } as never,
  });

  it('returns the component it is given', () => {
    const given = container({ name: 'given' });
    expect(
      resolveContainerComponent(project([container()]), given, 'target'),
    ).toBe(given);
  });

  it('finds the only container component on the project', () => {
    expect(
      resolveContainerComponent(
        project([{ generator: 'ts#agent', name: 'agent' }, container()]),
        undefined,
        'target',
      ),
    ).toEqual(container());
  });

  it('throws when the project has no container component', () => {
    expect(() =>
      resolveContainerComponent(project([]), undefined, 'target'),
    ).toThrow(
      'Project svc has no ts#container or py#container component to connect to.',
    );
  });

  it('throws when the project has several container components', () => {
    expect(() =>
      resolveContainerComponent(
        project([container(), container({ name: 'billing' })]),
        undefined,
        'source',
      ),
    ).toThrow(
      'Project svc has several container components (orders, billing). Choose one with sourceComponent.',
    );
  });
});

describe('containerServiceNames', () => {
  it('derives the names from the component metadata', () => {
    expect(
      containerServiceNames(
        { name: 'svc', root: 'packages/svc' },
        container({ rc: 'MyProjectService', name: 'service', port: 8090 }),
      ),
    ).toEqual({
      nameClassName: 'MyProjectService',
      nameKebabCase: 'my-project-service',
      moduleName: 'my_project_service',
      variableName: 'myProjectService',
      prefix: 'service',
      port: 8090,
      iac: 'cdk',
      sourceDir: 'packages/svc/src/orders',
    });
  });
});

describe('terraformRolePolicy', () => {
  it('formats an aws_iam_role_policy for the given role', () => {
    expect(
      terraformRolePolicy({
        label: 'my_service_invoke',
        role: 'module.user_identity.authenticated_role_name',
        statements: [
          `{
  Effect   = "Allow"
  Action   = ["execute-api:Invoke"]
  Resource = ["\${module.my_service.api_execution_arn}/*"]
},`,
        ],
      }),
    ).toBe(`resource "aws_iam_role_policy" "my_service_invoke" {
  name = "my-service-invoke"
  role = module.user_identity.authenticated_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["execute-api:Invoke"]
        Resource = ["\${module.my_service.api_execution_arn}/*"]
      },
    ]
  })
}`);
  });
});
