/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import type { Root } from 'mdast';
import { collectFilterableKeysFromJsx } from '../../../packages/nx-plugin/src/mcp-server/mdx-ast';

/**
 * Parse raw MDX and return every option key referenced by
 * `<OptionFilter when>` / `<TabItem _filter>` blocks. Used by the filter
 * bar to decide which dropdowns to render per page.
 */
export const collectReferencedKeys = (text: string): string[] => {
  let tree: Root;
  try {
    tree = unified().use(remarkParse).use(remarkMdx).parse(text) as Root;
  } catch {
    return [];
  }
  return [...collectFilterableKeysFromJsx(tree)];
};
