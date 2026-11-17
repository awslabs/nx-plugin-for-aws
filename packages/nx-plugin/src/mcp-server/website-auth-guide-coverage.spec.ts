/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGeneratorInfoList,
  type NxGeneratorInfo,
} from '../utils/generators.js';
import {
  fetchGuidePagesForGenerator,
  renderFilterableOptionsAsync,
} from './generator-info.js';

/**
 * `ts#website#auth` has two guide pages: the auth page, with
 * `when: federation: [none, oidc]`, and the identity providers page, with
 * `when: federation: [oidc]`. Unsupported combinations are inferred from the
 * `when:` predicates of a generator's pages, so without the auth page's
 * predicate `federation: none` would be reported as unsupported. These tests
 * read the real guide pages.
 */
describe('website auth guide coverage', () => {
  const generators = buildGeneratorInfoList(join(__dirname, '../..'));
  const byId = (id: string): NxGeneratorInfo => {
    const info = generators.find((g) => g.id === id);
    if (!info) throw new Error(`${id} is not in generators.json`);
    return info;
  };
  const websiteAuth = byId('ts#website#auth');
  const reactWebsiteAuth = byId('ts#react-website#auth');

  // A heading only the auth page has, and one only the identity providers page has.
  const AUTH_PAGE = /^#### Threat protection$/m;
  const IDP_PAGE = /^## Who can sign in$/m;

  const guide = (info: NxGeneratorInfo, options?: Record<string, string>) =>
    fetchGuidePagesForGenerator(info, generators, 'pnpm', undefined, options);

  it('returns only the auth page for federation none', async () => {
    const result = await guide(websiteAuth, { federation: 'none' });

    expect(result.kind).toBe('ok');
    expect(result.content).toMatch(AUTH_PAGE);
    expect(result.content).not.toMatch(IDP_PAGE);
  });

  it('returns both pages for federation oidc', async () => {
    const result = await guide(websiteAuth, { federation: 'oidc' });

    expect(result.kind).toBe('ok');
    expect(result.content).toMatch(AUTH_PAGE);
    expect(result.content).toMatch(IDP_PAGE);
  });

  it('returns both pages when no options are supplied', async () => {
    const result = await guide(websiteAuth);

    expect(result.kind).toBe('ok');
    expect(result.content).toMatch(AUTH_PAGE);
    expect(result.content).toMatch(IDP_PAGE);
  });

  it('returns both pages when options do not include federation', async () => {
    const result = await guide(websiteAuth, { iac: 'cdk' });

    expect(result.kind).toBe('ok');
    expect(result.content).toMatch(AUTH_PAGE);
    expect(result.content).toMatch(IDP_PAGE);
  });

  it('reports an unknown federation value as unsupported', async () => {
    const result = await guide(websiteAuth, { federation: 'saml' });

    expect(result.kind).toBe('unsupported');
    expect(result.content).toContain('Unsupported combination');
  });

  it('lists federation as a filterable option', async () => {
    expect(await renderFilterableOptionsAsync(websiteAuth)).toContain(
      '- federation: none | oidc',
    );
  });

  // The hidden ts#react-website#auth shares the auth page and has no federation option.
  it.each([
    ['no options', undefined],
    ['options without federation', { iac: 'cdk' }],
  ])(
    'returns the auth page for ts#react-website#auth with %s',
    async (_, options) => {
      expect(reactWebsiteAuth.guidePages).toEqual(['react-website-auth']);

      const result = await guide(reactWebsiteAuth, options);

      expect(result.kind).toBe('ok');
      expect(result.content).toMatch(AUTH_PAGE);
      expect(result.content).not.toMatch(IDP_PAGE);
    },
  );
});
