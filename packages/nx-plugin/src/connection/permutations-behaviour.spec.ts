/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  CONNECTION_EXPECTATIONS,
  type ConnectionOutcome,
} from './connection-expectations';
import {
  type ConnectionKey,
  connectionGenerator,
  SUPPORTED_CONNECTIONS,
} from './generator';
import {
  type ConnectionType,
  type DimensionValues,
  readConnectionTypeDimensionDefaults,
  readConnectionTypeDimensions,
  sampleDimensionValues,
} from './permutations';

/**
 * Behavioural verification of the permutation expectations, run entirely on an
 * in-memory Tree (no installs/builds). The tier's job is to prove the
 * `unsupported` rows of the expectation table are honest: that running the real
 * connection generator for an unsupported permutation throws a clear,
 * user-facing error rather than crashing or vending broken code.
 *
 * Validity of the *supported* permutations (that the vended code actually
 * builds) is proven by the e2e build tier — it cannot be checked from a Tree.
 */

/**
 * Write a project whose type + dimension values the connection generator can
 * resolve. Each side gets at most one connection-participating component/type so
 * `resolveConnection` is unambiguous.
 */
const writeProjectForType = (
  tree: Tree,
  projectName: string,
  type: ConnectionType,
  dims: DimensionValues,
): void => {
  const root = `packages/${projectName}`;
  const componentMetadata = (generator: ConnectionType) => ({
    generator,
    name: projectName,
    path: `src/${projectName}`,
    rc: 'Comp',
    port: 8080,
    ...dims,
  });

  const writeJson = (metadata: object, extra: object = {}) =>
    tree.write(
      `${root}/project.json`,
      JSON.stringify({
        name: projectName,
        root,
        sourceRoot: `${root}/src`,
        ...extra,
        metadata,
      }),
    );

  switch (type) {
    case 'react':
      tree.write(`${root}/src/main.tsx`, '');
      writeJson({});
      break;
    case 'ts#trpc-api':
      writeJson({ apiType: 'trpc' });
      break;
    case 'py#fast-api':
      writeJson({ apiType: 'fast-api' });
      break;
    case 'smithy':
      writeJson({ generator: 'smithy#project' });
      break;
    case 'ts#agent':
    case 'py#agent':
    case 'ts#mcp-server':
    case 'py#mcp-server':
      writeJson({ components: [componentMetadata(type)] });
      break;
    case 'agentcore-gateway':
      writeJson({
        generator: 'agentcore-gateway',
        rc: 'Gw',
        port: 9000,
        ...dims,
      });
      break;
    case 'ts#rdb':
    case 'ts#dynamodb':
    case 'py#dynamodb':
      writeJson({ generator: type, ...dims });
      break;
  }
};

interface UnsupportedCase {
  readonly key: ConnectionKey;
  readonly source: ConnectionType;
  readonly target: ConnectionType;
  readonly sourceDims: DimensionValues;
  readonly targetDims: DimensionValues;
  readonly errorMatches: RegExp;
}

/**
 * Build the list of sampled permutations the table marks `unsupported`, across
 * every supported routing pair. A bounded sample per side (defaults + one per
 * enum value) keeps this fast while still hitting each guard.
 */
const collectUnsupportedCases = (): UnsupportedCase[] => {
  const cases: UnsupportedCase[] = [];
  for (const connection of SUPPORTED_CONNECTIONS) {
    const key = `${connection.source} -> ${connection.target}` as ConnectionKey;
    const expectation = CONNECTION_EXPECTATIONS[key];
    const source = connection.source as ConnectionType;
    const target = connection.target as ConnectionType;
    const sourceCells = sampleDimensionValues(
      readConnectionTypeDimensions(source),
      readConnectionTypeDimensionDefaults(source),
    );
    const targetCells = sampleDimensionValues(
      readConnectionTypeDimensions(target),
      readConnectionTypeDimensionDefaults(target),
    );
    for (const sourceDims of sourceCells) {
      for (const targetDims of targetCells) {
        const outcome: ConnectionOutcome = expectation({
          source: sourceDims,
          target: targetDims,
        });
        if (outcome.kind === 'unsupported') {
          cases.push({
            key,
            source,
            target,
            sourceDims,
            targetDims,
            errorMatches: outcome.errorMatches,
          });
        }
      }
    }
  }
  return cases;
};

describe('connection permutations - behaviour', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const unsupportedCases = collectUnsupportedCases();

  it('there are unsupported permutations to verify', () => {
    // Sanity: if this ever hits zero, the sampling or expectations regressed.
    expect(unsupportedCases.length).toBeGreaterThan(0);
  });

  describe('unsupported permutations throw a clear error', () => {
    it.each(
      unsupportedCases.map((c) => ({
        ...c,
        label: `${c.key} [src ${JSON.stringify(c.sourceDims)} -> tgt ${JSON.stringify(c.targetDims)}]`,
      })),
    )('$label', async ({
      source,
      target,
      sourceDims,
      targetDims,
      errorMatches,
    }) => {
      writeProjectForType(tree, 'source_project', source, sourceDims);
      writeProjectForType(tree, 'target_project', target, targetDims);

      await expect(
        connectionGenerator(tree, {
          sourceProject: 'source_project',
          targetProject: 'target_project',
        }),
      ).rejects.toThrow(errorMatches);
    });
  });
});
