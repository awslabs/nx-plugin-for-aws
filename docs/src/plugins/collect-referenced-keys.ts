/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import type { Root, RootContent } from 'mdast';
import type {
  MdxJsxAttribute,
  MdxJsxAttributeValueExpression,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from 'mdast-util-mdx-jsx';
import { parseWhenExpression } from '../../../packages/nx-plugin/src/mcp-server/option-filter';

/**
 * Parse a raw MDX source with unified + remark-mdx and return every option
 * key referenced by `<OptionFilter when={{…}}>` blocks. Used at Astro
 * build time by the filter bar to decide which dropdowns to show for a
 * given guide page.
 */
export const collectReferencedKeys = (text: string): string[] => {
  let tree: Root;
  try {
    tree = unified().use(remarkParse).use(remarkMdx).parse(text) as Root;
  } catch {
    return [];
  }
  const keys = new Set<string>();
  const walk = (parent: Root | MdxJsxFlowElement | MdxJsxTextElement): void => {
    const children = parent.children as RootContent[];
    for (const child of children) {
      if (!isJsxElement(child)) continue;
      if (child.name === 'OptionFilter') {
        const estree = readEstreeAttr(child, 'when');
        if (estree) {
          try {
            const pred = parseWhenExpression(estree as never);
            for (const key of Object.keys(pred)) keys.add(key);
          } catch {
            // Malformed / partially-typed — skip.
          }
        }
      }
      walk(child);
    }
  };
  walk(tree);
  return [...keys];
};

const isJsxElement = (
  node: RootContent,
): node is MdxJsxFlowElement | MdxJsxTextElement =>
  node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';

const readEstreeAttr = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
  name: string,
): unknown | undefined => {
  const attr = node.attributes.find(
    (a): a is MdxJsxAttribute =>
      a.type === 'mdxJsxAttribute' && a.name === name,
  );
  if (!attr) return undefined;
  if (typeof attr.value === 'object' && attr.value !== null) {
    return (attr.value as MdxJsxAttributeValueExpression).data?.estree;
  }
  return undefined;
};
