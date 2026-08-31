/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildGeneratorInfoList,
  describeGeneratorForCatalogue,
  findGeneratorsJsonEntry,
  generatorsJsonEntries,
} from './generators.js';

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

  it('should surface the experimental flag for every generator that sets it', () => {
    const generators = buildGeneratorInfoList(process.cwd());

    for (const [id, entry] of Object.entries(generatorsJsonEntries)) {
      // The flag is spread conditionally, so an unflagged generator must be
      // `undefined` rather than `false`.
      expect(
        generators.find((g) => g.id === id)?.experimental,
        `experimental flag not surfaced for ${id}`,
      ).toBe(entry.experimental ? true : undefined);
    }
  });

  describe('findGeneratorsJsonEntry', () => {
    it('should return the entry for a known generator', () => {
      expect(findGeneratorsJsonEntry('ts#project')?.metric).toBe(
        generatorsJsonEntries['ts#project'].metric,
      );
    });

    it('should return undefined for an unknown generator', () => {
      expect(findGeneratorsJsonEntry('does#not-exist')).toBeUndefined();
    });
  });

  describe('describeGeneratorForCatalogue', () => {
    it('should mark an experimental generator', () => {
      expect(
        describeGeneratorForCatalogue({
          description: 'Generate a thing',
          experimental: true,
        }),
      ).toBe('Generate a thing (experimental)');
    });

    it('should leave a stable generator undecorated', () => {
      expect(
        describeGeneratorForCatalogue({ description: 'Generate a thing' }),
      ).toBe('Generate a thing');
    });
  });

  // The package README's generator table is a curated subset with its own
  // descriptions, so nothing regenerates it when a generator is marked
  // experimental.
  it('should mark experimental generators in the package README table', () => {
    const readme = readFileSync(
      join(__dirname, '..', '..', 'README.md'),
      'utf-8',
    );
    const rows = [...readme.matchAll(/^\| `([^`]+)`\s*\| (.*?)\s*\|$/gm)].map(
      (match) => ({ id: match[1], description: match[2] }),
    );

    expect(rows.length).toBeGreaterThan(0);

    const unmarked = rows
      .filter(
        ({ id, description }) =>
          findGeneratorsJsonEntry(id)?.experimental === true &&
          !description.includes('(experimental)'),
      )
      .map(({ id }) => id);

    expect(
      unmarked,
      `These generators are experimental in generators.json but the README table does not say so. Add "(experimental)" to their description in packages/nx-plugin/README.md, then copy it to the root README.md.\n${unmarked.join('\n')}`,
    ).toEqual([]);
  });
});
