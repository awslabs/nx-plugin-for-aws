/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The option values a guide page is read under.
 *
 * The reader picks them in the page's run-generator card, which announces them to
 * everything else on the page; what a shared link or a previous visit left is read
 * back with `readPageSelection`, by the card (to fill its controls) and by the
 * page's option controller (to filter the guide before the card announces).
 */

/**
 * The values a page fixes itself, read off its frontmatter `when:` predicate.
 *
 * A page that names one value for an option — the tRPC guide's
 * `when: framework: [trpc]` — is that variant of the generator's guide, so the
 * docs treat the value as fixed: its command shows it without offering to change
 * it, and options that don't apply under it are left out. A key naming several
 * values leaves the choice open.
 */
export type PageWhen = Record<
  string,
  string | number | boolean | (string | number | boolean)[]
>;

export const pinnedPageOptions = (
  when: PageWhen | undefined,
): Record<string, string> => {
  const pinned: Record<string, string> = {};
  for (const [key, value] of Object.entries(when ?? {})) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 1) pinned[key] = String(values[0]);
  }
  return pinned;
};

/**
 * The values a page was opened with: `?f=…` in the URL first — a shared link is
 * about the guide someone meant to send — then what the reader last chose.
 *
 * Only the keys the page tracks are kept, so a stale link or a schema change
 * can't smuggle in values nothing on the page knows about.
 */
export const readPageSelection = (
  storageKey: string,
  keys: Set<string>,
): Record<string, string> => {
  const kept = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).filter(([key, value]) => keys.has(key) && !!value),
    );

  let stored: Record<string, string> = {};
  try {
    stored = kept(JSON.parse(localStorage.getItem(storageKey) || '{}'));
  } catch {
    // Nothing usable stored.
  }

  // Filters live in the query string (e.g. `?f=infra:rest-lambda,auth:iam`)
  // rather than the URL hash — the hash is reserved for table-of-contents
  // navigation, which would otherwise clobber the selection.
  const match = /[?&]f=([^&#]+)/.exec(location.search);
  const fromQuery: Record<string, string> = {};
  if (match) {
    for (const pair of decodeURIComponent(match[1]).split(',')) {
      const [key, value] = pair.split(':');
      if (key && value) fromQuery[key] = value;
    }
  }

  return { ...stored, ...kept(fromQuery) };
};
