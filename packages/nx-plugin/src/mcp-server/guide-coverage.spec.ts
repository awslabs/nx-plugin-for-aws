/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildGeneratorInfoList } from '../utils/generators.js';
import {
  fetchGuideFrontmatters,
  fetchGuidePages,
  fetchGuidePagesForGenerator,
} from './generator-info.js';
import { BEST_PRACTICE_PAGE_NAMES } from './tools/best-practices.js';

describe('guide coverage', () => {
  const generators = buildGeneratorInfoList(join(__dirname, '../..'));
  const visible = generators.filter((g) => !g.hidden);

  it.each(visible.map((g) => [g.id]))(
    '%s resolves at least one guide page',
    async (id) => {
      const info = generators.find((g) => g.id === id)!;
      const fetched = await fetchGuideFrontmatters(info);

      expect(fetched.length).toBeGreaterThan(0);

      const result = await fetchGuidePagesForGenerator(
        info,
        generators,
        'pnpm',
      );
      expect(result.kind).toBe('ok');
      expect(result.content).not.toBe('');
    },
  );

  it.each(generators.filter((g) => g.guidePages).map((g) => [g.id]))(
    'every guide page %s declares exists on disk',
    async (id) => {
      const info = generators.find((g) => g.id === id)!;
      const declared = [...(info.guidePages ?? [])];
      const fetched = await fetchGuideFrontmatters(info);

      expect(fetched.map((f) => f.page).sort()).toEqual(declared.sort());
    },
  );

  it.each(BEST_PRACTICE_PAGE_NAMES.map((page) => [page]))(
    'best-practices resolves the %s page',
    async (page) => {
      expect(await fetchGuidePages([page], generators, 'pnpm')).not.toBe('');
    },
  );
});
