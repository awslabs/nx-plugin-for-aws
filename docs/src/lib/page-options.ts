/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The option values a guide page is written around, read off its frontmatter
 * `when:` predicate.
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
