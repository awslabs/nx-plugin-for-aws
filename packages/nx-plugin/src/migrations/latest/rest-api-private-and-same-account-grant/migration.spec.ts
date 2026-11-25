/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_CONSTRUCTS_DEPENDENCIES,
  addApiGatewayInfra,
} from '../../../utils/api-constructs/api-constructs.js';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PATH = 'packages/common/constructs/src/app/apis/web-api.ts';

const generate = async (auth: 'iam' | 'cognito') => {
  const tree = createTreeUsingTsSolutionSetup();
  const declaration = declareDependencies()({
    ts: [...SHARED_CONSTRUCTS_DEPENDENCIES, ...API_CONSTRUCTS_DEPENDENCIES],
  });
  await sharedConstructsGenerator(tree, { iac: 'cdk' }, declaration);
  await addApiGatewayInfra(
    tree,
    {
      iac: 'cdk',
      apiProjectName: '@proj/web-api',
      apiNameClassName: 'WebApi',
      apiNameKebabCase: 'web-api',
      constructType: 'rest',
      backend: {
        type: 'smithy',
        integrationPattern: 'isolated',
        bundleOutputDir: 'dist/packages/web-api/bundle',
      },
      auth,
    },
    declaration,
  );
  // As formatted in a workspace, where the migration formats too
  await formatFilesInSubtree(tree);
  const generated = tree.read(PATH, 'utf-8') ?? '';
  const old = readFileSync(
    join(import.meta.dirname, `old-web-api-${auth}.ts.fixture`),
    'utf-8',
  );
  expect(old).not.toContain('endpointConfiguration');
  tree.write(PATH, old);
  // As formatted in a workspace, where the migration formats too
  await formatFilesInSubtree(tree);
  const formatted = createTreeUsingTsSolutionSetup();
  formatted.write(PATH, generated);
  await formatFilesInSubtree(formatted);
  return { tree, generated: formatted.read(PATH, 'utf-8') ?? '' };
};

describe('rest-api-private-and-same-account-grant', () => {
  it.each(['iam', 'cognito'] as const)(
    'should leave a %s REST API construct as the generator writes it now',
    async (auth) => {
      const { tree, generated } = await generate(auth);

      await migration(tree);

      expect(tree.read(PATH, 'utf-8')).toBe(generated);
    },
  );

  it('should change nothing when run again', async () => {
    const { tree, generated } = await generate('iam');
    await migration(tree);

    const result = await migration(tree);

    expect(tree.read(PATH, 'utf-8')).toBe(generated);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a construct that has diverged, and say so', async () => {
    const { tree } = await generate('iam');
    // A grant written by hand, which the grant edit cannot find
    const diverged = (tree.read(PATH, 'utf-8') ?? '').replace(
      'Grant.addToPrincipal(',
      'myOwnGrant(',
    );
    tree.write(PATH, diverged);

    const result = await migration(tree);

    expect(tree.read(PATH, 'utf-8')).toBe(diverged);
    expect(result.nextSteps).toEqual([expect.stringContaining(PATH)]);
  });
});
