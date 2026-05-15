/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Root, RootContent } from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import {
  isJsxElement,
  readEstreeAttr,
  type JsxParent,
} from '../../../packages/nx-plugin/src/mcp-server/mdx-ast';
import { parseWhenExpression } from '../../../packages/nx-plugin/src/mcp-server/option-filter';

/**
 * Lifts `<TabItem _filter={...}>` predicates onto a sibling `<div
 * data-tab-filters>` element that the option-filter bar's client script
 * can read at runtime.
 *
 * Starlight's docs site strips `_filter` (it is only consumed by the MCP
 * server). To enable the filter bar to auto-switch the active tab when the
 * user picks an option value, this plugin inserts a marker sibling
 * immediately before each `<Tabs>` element whose `<TabItem>` children carry
 * `_filter`. The marker carries the per-tab predicates as JSON so the
 * client script can match labels against the user's current selection
 * without needing to keep the predicates in the DOM tree of the tab links
 * themselves.
 */

type TabFilter = {
  label: string;
  when: Record<string, string[]>;
};

const readTabLabel = (node: MdxJsxFlowElement): string | undefined => {
  const attr = node.attributes.find(
    (a) =>
      a.type === 'mdxJsxAttribute' &&
      a.name === 'label' &&
      typeof a.value === 'string',
  );
  return attr && attr.type === 'mdxJsxAttribute'
    ? (attr.value as string)
    : undefined;
};

const collectTabFilters = (tabs: MdxJsxFlowElement): TabFilter[] => {
  const filters: TabFilter[] = [];
  for (const child of tabs.children) {
    if (!isJsxElement(child) || child.name !== 'TabItem') continue;
    const label = readTabLabel(child as MdxJsxFlowElement);
    if (!label) continue;
    const estree = readEstreeAttr(child, '_filter');
    if (!estree) continue;
    let when: Record<string, string[]>;
    try {
      when = parseWhenExpression(estree as never);
    } catch {
      continue;
    }
    filters.push({ label, when });
  }
  return filters;
};

const makeMarker = (filters: TabFilter[]): MdxJsxFlowElement => ({
  type: 'mdxJsxFlowElement',
  name: 'div',
  attributes: [
    {
      type: 'mdxJsxAttribute',
      name: 'data-tab-filters',
      value: JSON.stringify(filters),
    },
    {
      type: 'mdxJsxAttribute',
      name: 'hidden',
      value: null,
    },
  ],
  children: [],
});

const visitParents = (parent: JsxParent) => {
  const children = parent.children as RootContent[];
  // Walk top-down, splicing markers before each <Tabs> with _filter children.
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isJsxElement(child)) continue;
    if (child.name === 'Tabs') {
      const filters = collectTabFilters(child as MdxJsxFlowElement);
      const previous = i > 0 ? children[i - 1] : undefined;
      const previousIsMarker =
        previous &&
        isJsxElement(previous) &&
        previous.name === 'div' &&
        previous.attributes.some(
          (a) => a.type === 'mdxJsxAttribute' && a.name === 'data-tab-filters',
        );
      if (filters.length > 0 && !previousIsMarker) {
        children.splice(i, 0, makeMarker(filters) as RootContent);
        i++; // skip the marker we just inserted
      }
    }
    visitParents(child);
  }
};

const remarkTabFilter = () => {
  return (tree: Root) => {
    visitParents(tree);
  };
};

export default remarkTabFilter;
