/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { CONNECTION_EXPECTATIONS } from './connection-expectations';
import { type ConnectionKey, SUPPORTED_CONNECTIONS } from './generator';
import {
  type ConnectionType,
  enumerateDimensionValues,
  readConnectionTypeDimensions,
} from './permutations';

/**
 * Snapshot of every connection type's schema enum dimensions, committed
 * deliberately. The test below asserts the live schemas still match this map.
 *
 * Adding (or removing) an enum value on any generator that participates in a
 * connection — e.g. a new agent `framework`, a new mcp-server `auth` mode — is
 * exactly the change that introduces unconsidered connection permutations. That
 * change will fail this test, and the failure is the prompt to:
 *   1. classify every new permutation in `connection-expectations.ts`
 *      (supported, or unsupported with a clear error), and
 *   2. update this snapshot to acknowledge the new dimension.
 *
 * Update this map ONLY together with the matching expectation changes.
 */
const KNOWN_DIMENSIONS: Record<ConnectionType, Record<string, string[]>> = {
  'ts#trpc-api': {
    integrationPattern: ['isolated', 'shared'],
    auth: ['iam', 'cognito', 'custom'],
    iac: ['inherit', 'cdk', 'terraform'],
    infra: ['rest-lambda', 'http-lambda', 'none'],
  },
  'py#fast-api': {
    integrationPattern: ['isolated', 'shared'],
    auth: ['iam', 'cognito', 'custom'],
    iac: ['inherit', 'cdk', 'terraform'],
    infra: ['rest-lambda', 'http-lambda', 'none'],
  },
  react: {
    framework: ['react'],
    ux: ['none', 'cloudscape', 'shadcn'],
    infra: ['cloudfront-s3', 'none'],
    iac: ['inherit', 'cdk', 'terraform'],
  },
  smithy: {
    integrationPattern: ['isolated', 'shared'],
    auth: ['iam', 'cognito', 'custom'],
    iac: ['inherit', 'cdk', 'terraform'],
    infra: ['rest-lambda', 'none'],
  },
  'ts#rdb': {
    infra: ['aurora', 'none'],
    engine: ['postgres', 'mysql'],
    framework: ['prisma'],
    iac: ['inherit', 'cdk', 'terraform'],
  },
  'ts#dynamodb': {
    framework: ['electrodb'],
    infra: ['dynamodb', 'none'],
    iac: ['inherit', 'cdk', 'terraform'],
  },
  'py#dynamodb': {
    framework: ['pynamodb'],
    infra: ['dynamodb', 'none'],
    iac: ['inherit', 'cdk', 'terraform'],
  },
  'agentcore-gateway': {
    protocol: ['mcp'],
    auth: ['iam'],
    infra: ['agentcore', 'none'],
    iac: ['inherit', 'cdk', 'terraform'],
  },
  'ts#agent': {
    framework: ['strands'],
    auth: ['iam', 'cognito'],
    protocol: ['http', 'a2a', 'ag-ui'],
    iac: ['inherit', 'cdk', 'terraform'],
    infra: ['agentcore', 'none'],
  },
  'py#agent': {
    framework: ['strands'],
    auth: ['iam', 'cognito'],
    protocol: ['http', 'a2a', 'ag-ui'],
    iac: ['inherit', 'cdk', 'terraform'],
    infra: ['agentcore', 'none'],
  },
  'ts#mcp-server': {
    auth: ['iam', 'cognito'],
    iac: ['inherit', 'cdk', 'terraform'],
    infra: ['agentcore', 'none'],
  },
  'py#mcp-server': {
    auth: ['iam', 'cognito'],
    iac: ['inherit', 'cdk', 'terraform'],
    infra: ['agentcore', 'none'],
  },
};

const connectionKey = (c: { source: string; target: string }): ConnectionKey =>
  `${c.source} -> ${c.target}` as ConnectionKey;

const allConnectionTypes = (): ConnectionType[] => [
  ...new Set(SUPPORTED_CONNECTIONS.flatMap((c) => [c.source, c.target])),
];

describe('connection permutations guard', () => {
  // The snapshot is the tripwire: any enum change to a connection-participating
  // generator desyncs this from the live schema and fails here, forcing the
  // contributor to consider the new permutations.
  describe('schema dimensions match the committed snapshot', () => {
    it.each(
      allConnectionTypes(),
    )('dimensions for %s are unchanged (update connection-expectations.ts + KNOWN_DIMENSIONS together)', (type) => {
      expect(readConnectionTypeDimensions(type)).toEqual(
        KNOWN_DIMENSIONS[type],
      );
    });

    it('snapshot covers exactly the connection types in SUPPORTED_CONNECTIONS', () => {
      expect(new Set(Object.keys(KNOWN_DIMENSIONS))).toEqual(
        new Set(allConnectionTypes()),
      );
    });
  });

  // Every routing pair must have an expectation entry. (The Record type already
  // enforces this at compile time; this guards against accidental loosening.)
  it('every supported connection has an expectation', () => {
    for (const connection of SUPPORTED_CONNECTIONS) {
      const key = connectionKey(connection);
      expect(
        CONNECTION_EXPECTATIONS[key],
        `No expectation declared for ${key}`,
      ).toBeTypeOf('function');
    }
  });

  // Exhaustiveness: every cell of the full source x target cartesian must be
  // classified as either supported or unsupported. An unsupported outcome must
  // carry a user-facing error matcher so the failure mode is a clear message,
  // never a crash or silently-broken generated code.
  describe('every permutation is classified', () => {
    it.each(
      SUPPORTED_CONNECTIONS.map((c) => connectionKey(c)),
    )('%s classifies its full cartesian', (key) => {
      const [source, target] = key.split(' -> ') as [
        ConnectionType,
        ConnectionType,
      ];
      const expectation = CONNECTION_EXPECTATIONS[key];
      const sourceCells = enumerateDimensionValues(
        readConnectionTypeDimensions(source),
      );
      const targetCells = enumerateDimensionValues(
        readConnectionTypeDimensions(target),
      );

      for (const s of sourceCells) {
        for (const t of targetCells) {
          const outcome = expectation({ source: s, target: t });
          const detail = `${key} @ source=${JSON.stringify(s)} target=${JSON.stringify(t)}`;
          expect(
            ['supported', 'unsupported'],
            `Unclassified permutation ${detail}`,
          ).toContain(outcome.kind);
          if (outcome.kind === 'unsupported') {
            expect(
              outcome.errorMatches,
              `unsupported outcome for ${detail} must declare errorMatches`,
            ).toBeInstanceOf(RegExp);
          }
        }
      }
    });
  });
});
