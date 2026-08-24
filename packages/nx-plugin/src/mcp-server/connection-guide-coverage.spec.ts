/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync } from 'fs';
import { join } from 'path';
import { SUPPORTED_CONNECTIONS } from '../connection/supported-connections';
import { buildGeneratorInfoList } from '../utils/generators';
import {
  fetchGuidePagesForGenerator,
  renderFilterableOptionsAsync,
} from './generator-info';

/**
 * `generator-guide` promises that a combination it accepts is one the
 * generator supports. These tests hold it to that promise for the
 * `connection` generator, whose variants are selected by the `when:`
 * frontmatter of its guide pages rather than by its JSON schema.
 *
 * Without them, a connection can be added to `SUPPORTED_CONNECTIONS` and
 * fully tested by the scaffold catalog while the MCP server still tells
 * agents it "will likely fail" — either because its guide page was never
 * registered in `generators.json`, or because that page spells an endpoint
 * type differently from the connection itself.
 */
describe('connection guide coverage', () => {
  const info = buildGeneratorInfoList(join(__dirname, '../..')).find(
    (g) => g.id === 'connection',
  )!;
  const guideDir = join(
    __dirname,
    '../../../../docs/src/content/docs/en/guides/connection',
  );

  it.each(SUPPORTED_CONNECTIONS.map((c) => [c.source, c.target]))(
    'resolves a guide for %s -> %s',
    async (source, target) => {
      const result = await fetchGuidePagesForGenerator(
        info,
        [info],
        'pnpm',
        undefined,
        { sourceType: source, targetType: target },
      );

      expect(result.kind).toBe('ok');
      expect(result.content).not.toBe('');
    },
  );

  it('registers every connection guide page in generators.json', () => {
    const onDisk = readdirSync(guideDir)
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => `connection/${f.replace(/\.mdx$/, '')}`);

    expect([...(info.guidePages ?? [])].sort()).toEqual(
      expect.arrayContaining(onDisk.sort()),
    );
  });

  it('names only real endpoint types in every when: predicate', async () => {
    const endpointTypes = new Set(
      SUPPORTED_CONNECTIONS.flatMap((c) => [c.source, c.target]),
    );

    const result = await fetchGuidePagesForGenerator(info, [info], 'pnpm');
    expect(result.kind).toBe('ok');

    const filterable = await renderFilterableOptionsAsync(info);

    const advertised = [
      ...filterable.matchAll(/^- (sourceType|targetType): (.+)$/gm),
    ]
      .flatMap(([, , values]) => values.split('|').map((v) => v.trim()))
      .map((v) => v.replace(/\s*\(default:.*\)$/, '').trim())
      .filter(Boolean);

    expect(advertised.length).toBeGreaterThan(0);
    expect(
      advertised.filter((type) => !endpointTypes.has(type as never)),
    ).toEqual([]);
  });
});
