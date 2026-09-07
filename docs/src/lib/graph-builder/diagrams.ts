/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DeclaredDiagram } from './infrastructure';

/**
 * Diagrams a page declares outright, where there is no project whose blueprint
 * would draw it: a mechanism spanning several projects, rather than the
 * infrastructure one generator deploys.
 *
 * Drawn with the same boxes, tiles and arrows as the infrastructure view, so a
 * reader moving between a guide's architecture and one of these is looking at the
 * same kind of picture. A tile without an icon is something no AWS service stands
 * for — a configuration namespace, a call in your own infrastructure code.
 */
export const DIAGRAMS: Readonly<Record<string, DeclaredDiagram>> = {
  'runtime-config': {
    boxes: [
      {
        id: 'iac',
        bare: true,
        column: 0,
        row: 0,
        resources: [
          {
            id: 'set',
            label: 'Infrastructure as code',
            detail: 'RuntimeConfig.set(…)',
            column: 0,
            row: 0,
          },
        ],
      },
      {
        id: 'appconfig',
        name: 'Runtime configuration',
        typeLabel: 'AWS AppConfig',
        column: 0,
        row: 1,
        resources: [
          {
            id: 'connection',
            label: 'connection',
            detail: 'namespace',
            icon: 'appconfig',
            column: 0,
            row: 0,
          },
          {
            id: 'agentcore',
            label: 'agentcore',
            detail: 'namespace',
            icon: 'appconfig',
            column: 1,
            row: 0,
          },
          {
            id: 'custom',
            label: 'custom',
            detail: 'namespaces',
            icon: 'appconfig',
            column: 2,
            row: 0,
          },
        ],
      },
      {
        id: 'website',
        name: 'website',
        typeLabel: 'React Website',
        column: 0,
        row: 2,
        resources: [
          {
            id: 'json',
            label: 'S3',
            detail: 'runtime-config.json',
            icon: 's3',
            column: 0,
            row: 0,
          },
        ],
      },
      {
        id: 'server',
        bare: true,
        column: 1,
        row: 2,
        resources: [
          {
            id: 'compute',
            label: 'Lambda or agent',
            detail: 'reads at runtime',
            icon: 'lambda',
            column: 0,
            row: 0,
          },
        ],
      },
      {
        id: 'browser',
        bare: true,
        column: 0,
        row: 3,
        resources: [
          {
            id: 'page',
            label: 'Web Browser',
            detail: 'reads at load',
            icon: 'client',
            column: 0,
            row: 0,
          },
        ],
      },
    ],
    connections: [
      ['iac:set', 'appconfig:connection'],
      // Only the connection namespace is deployed to the website, so the values
      // the other namespaces hold stay server-side.
      ['appconfig:connection', 'website:json'],
      ['website:json', 'browser:page'],
      ['appconfig:agentcore', 'server:compute'],
    ],
  },
};

export const declaredDiagram = (name: string): DeclaredDiagram | undefined =>
  DIAGRAMS[name];
