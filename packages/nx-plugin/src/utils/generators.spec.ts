/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildGeneratorInfoList } from './generators';

describe('generators', () => {
  it('should not have duplicate metrics across generators', () => {
    const generators = buildGeneratorInfoList(process.cwd());

    const generatorsByMetric = new Map<string, string[]>();
    for (const { id, metric } of generators) {
      const ids = generatorsByMetric.get(metric) ?? [];
      ids.push(id);
      generatorsByMetric.set(metric, ids);
    }

    const duplicates = [...generatorsByMetric.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([metric, ids]) => `${metric}: ${ids.join(', ')}`);

    expect(
      duplicates,
      `Each generator must have a unique metric. Assign a new metric id to the most recently introduced generator.\nDuplicates found:\n${duplicates.join('\n')}`,
    ).toEqual([]);
  });
});
