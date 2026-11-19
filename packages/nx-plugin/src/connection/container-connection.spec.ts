/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProjectConfiguration } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import {
  assertContainerConnectionConstraints,
  CONTAINER_GENERATOR_IDS,
  containerServiceNames,
  resolveContainerComponent,
  terraformRolePolicy,
} from './container-connection.js';
import { CONNECTION_CONSTRAINTS } from './scaffold-catalog.js';
import { SUPPORTED_CONNECTIONS } from './supported-connections.js';

const CONTAINER_DATA_CONNECTIONS = [
  'py#container -> py#dynamodb',
  'py#container -> py#rdb',
  'ts#container -> ts#dynamodb',
  'ts#container -> ts#rdb',
];

describe('container connection registry', () => {
  it('keeps only the four container data connections', () => {
    expect(
      SUPPORTED_CONNECTIONS.filter(
        ({ source, target }) =>
          CONTAINER_GENERATOR_IDS.includes(source) ||
          CONTAINER_GENERATOR_IDS.includes(target),
      )
        .map(({ source, target }) => `${source} -> ${target}`)
        .sort(),
    ).toEqual(CONTAINER_DATA_CONNECTIONS);
  });

  it('constrains each kept pair to a source with infra ecs', () => {
    const entries = Object.entries(CONNECTION_CONSTRAINTS).filter(([key]) =>
      key.includes('#container'),
    );
    expect(entries.map(([key]) => key).sort()).toEqual(
      CONTAINER_DATA_CONNECTIONS,
    );
    for (const [, constraints] of entries) {
      expect(constraints).toEqual([
        expect.objectContaining({
          side: 'source',
          option: 'infra',
          equals: 'ecs',
        }),
      ]);
    }
  });

  it('exports only the shared container helpers', async () => {
    expect(
      Object.keys(await import('./container-connection.js')).sort(),
    ).toEqual(
      [
        'CONTAINER_GENERATOR_IDS',
        'assertContainerConnectionConstraints',
        'containerServiceNames',
        'resolveContainerComponent',
        'terraformRolePolicy',
      ].sort(),
    );
  });
});

const container = (overrides: Record<string, unknown> = {}) => ({
  generator: 'ts#container',
  name: 'orders',
  path: 'src/orders',
  port: 8083,
  rc: 'Orders',
  infra: 'ecs',
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

    it('names both ends in the message', () => {
      expect(() =>
        assertContainerConnectionConstraints(
          key,
          { source: container({ infra: 'none' }) },
          { source: 'svc (orders)', target: 'db' },
        ),
      ).toThrow(/^Cannot connect svc \(orders\) to db: /);
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
        { root: 'packages/svc' },
        container({ rc: 'MyProjectContainer', name: 'container', port: 8090 }),
      ),
    ).toEqual({
      nameClassName: 'MyProjectContainer',
      nameKebabCase: 'my-project-container',
      moduleName: 'my_project_container',
      variableName: 'myProjectContainer',
      prefix: 'container',
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
        label: 'orders_my_table_access',
        role: 'module.orders.task_role_name',
        statements: [
          `{
  Effect   = "Allow"
  Action   = ["dynamodb:GetItem"]
  Resource = [module.my_table.table_arn]
},`,
        ],
      }),
    ).toBe(`resource "aws_iam_role_policy" "orders_my_table_access" {
  name = "orders-my-table-access"
  role = module.orders.task_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = [module.my_table.table_arn]
      },
    ]
  })
}`);
  });
});
