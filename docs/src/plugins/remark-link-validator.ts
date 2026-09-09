/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { readStringAttr } from '../../../packages/nx-plugin/src/mcp-server/mdx-ast';

/**
 * Remark plugin that validates every `<Link path>` against the pages that
 * exist in the same locale.
 *
 * `starlight-links-validator` cannot check these: it compares an href to the
 * built routes, whereas `path` is a locale-agnostic slug that
 * `@components/link.astro` resolves through `getRelativeLocaleUrl`, adding the
 * locale and the site base itself. Pointing the validator's `components`
 * option at the prop therefore rejects every correct link and, because it only
 * reads block-level JSX, still misses the inline `<Link>`s that make up nearly
 * all of the cross-references here.
 *
 * Build fails on:
 *   - a `path` with no corresponding page in the file's locale
 *   - a `path` carrying a locale segment, which would resolve to `/jp/jp/...`
 */

const DOCS_DIR = path.resolve(import.meta.dirname, '../content/docs');

/** Locale directories under `content/docs`, i.e. every dir bar `assets`. */
const readLocales = (): string[] =>
  fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'assets')
    .map((e) => e.name)
    .sort();

/**
 * The slugs a locale serves, derived from its `.md`/`.mdx` files the same way
 * Astro derives routes: the extension is dropped and a trailing `index`
 * collapses to its directory.
 */
const readSlugs = (locale: string): Set<string> => {
  const root = path.join(DOCS_DIR, locale);
  const slugs = new Set<string>();

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (/\.mdx?$/.test(entry.name)) {
        slugs.add(
          path
            .relative(root, abs)
            .split(path.sep)
            .join('/')
            .replace(/\.mdx?$/, '')
            .replace(/(^|\/)index$/, '')
            .replace(/\/$/, ''),
        );
      }
    }
  };
  walk(root);

  return slugs;
};

const LOCALES = readLocales();
const SLUGS = new Map(LOCALES.map((locale) => [locale, readSlugs(locale)]));

/** The locale a docs file belongs to, or undefined for anything outside them. */
const localeOf = (filePath: string): string | undefined => {
  const rel = path.relative(DOCS_DIR, filePath).split(path.sep).join('/');
  if (rel.startsWith('..')) return undefined;
  const locale = rel.split('/')[0];
  return locale && SLUGS.has(locale) ? locale : undefined;
};

/** Strip the hash and query, then the surrounding slashes, off a `path` prop. */
const toSlug = (value: string): string =>
  value.split('#')[0].split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');

const remarkLinkValidator = () => {
  return (tree: Root, file: { path?: string }) => {
    const filePath = file?.path;
    if (!filePath) return;

    const locale = localeOf(filePath);
    if (!locale) return;

    const slugs = SLUGS.get(locale)!;
    const pagePath = path
      .relative(DOCS_DIR, filePath)
      .split(path.sep)
      .join('/');

    // Both node types, and the whole tree rather than only JSX subtrees: nearly
    // every cross-reference here is an inline `<Link>` inside a paragraph.
    visit(tree, ['mdxJsxFlowElement', 'mdxJsxTextElement'], (node) => {
      const element = node as Parameters<typeof readStringAttr>[0];
      if (element.name !== 'Link') return;

      const value = readStringAttr(element, 'path');
      if (value === undefined) return;

      const slug = toSlug(value);
      // An empty slug is the locale's own landing page, which always exists.
      if (slug === '') return;

      const prefix = slug.split('/')[0];
      if (LOCALES.includes(prefix)) {
        throw new Error(
          `[remark-link-validator] ${pagePath}: <Link path="${value}"> starts with the locale '${prefix}'. ` +
            `A path is resolved against the reader's locale, so this renders as '/${locale}/${slug}' and 404s. ` +
            `Drop the locale: path="${slug.slice(prefix.length + 1)}".`,
        );
      }

      if (!slugs.has(slug)) {
        throw new Error(
          `[remark-link-validator] ${pagePath}: <Link path="${value}"> points at '${slug}', which is not a page in the '${locale}' locale.`,
        );
      }
    });
  };
};

export default remarkLinkValidator;
