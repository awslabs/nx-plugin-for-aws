/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Root, RootContent, Yaml } from 'mdast';
import type {
  MdxJsxAttribute,
  MdxJsxAttributeValueExpression,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from 'mdast-util-mdx-jsx';
import yaml from 'js-yaml';
import { parseWhenExpression } from './option-filter';

export type JsxParent = Root | MdxJsxFlowElement | MdxJsxTextElement;
export type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;

export const isJsxElement = (node: RootContent): node is JsxElement =>
  node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';

const findAttr = (
  node: JsxElement,
  name: string,
): MdxJsxAttribute | undefined =>
  node.attributes.find(
    (a): a is MdxJsxAttribute =>
      a.type === 'mdxJsxAttribute' && a.name === name,
  );

export const readStringAttr = (
  node: JsxElement,
  name: string,
): string | undefined => {
  const attr = findAttr(node, name);
  return typeof attr?.value === 'string' ? attr.value : undefined;
};

export const readExpressionAttr = (
  node: JsxElement,
  name: string,
): string | undefined => {
  const attr = findAttr(node, name);
  if (attr && typeof attr.value === 'object' && attr.value !== null) {
    return (attr.value as MdxJsxAttributeValueExpression).value;
  }
  return undefined;
};

export const readEstreeAttr = (
  node: JsxElement,
  name: string,
): unknown | undefined => {
  const attr = findAttr(node, name);
  if (attr && typeof attr.value === 'object' && attr.value !== null) {
    return (attr.value as MdxJsxAttributeValueExpression).data?.estree;
  }
  return undefined;
};

export const hasBareAttr = (node: JsxElement, name: string): boolean =>
  node.attributes.some((a) => a.type === 'mdxJsxAttribute' && a.name === name);

/** Walk every JSX element in the subtree, pre-order. */
export const walkJsx = (
  parent: JsxParent,
  visit: (node: JsxElement, parent: JsxParent) => void,
): void => {
  const children = parent.children as RootContent[];
  for (const child of children) {
    if (!isJsxElement(child)) continue;
    visit(child, parent);
    walkJsx(child, visit);
  }
};

/**
 * Every option key referenced by `<OptionFilter when>` or
 * `<TabItem _filter>` in the subtree. Malformed predicates are skipped.
 */
export const collectFilterableKeysFromJsx = (tree: Root): Set<string> => {
  const keys = new Set<string>();
  walkJsx(tree, (node) => {
    const attrName =
      node.name === 'OptionFilter'
        ? 'when'
        : node.name === 'TabItem'
          ? '_filter'
          : undefined;
    if (!attrName) return;
    const estree = readEstreeAttr(node, attrName);
    if (!estree) return;
    try {
      for (const key of Object.keys(parseWhenExpression(estree as never))) {
        keys.add(key);
      }
    } catch {
      // Malformed / partially-typed — skip.
    }
  });
  return keys;
};

/**
 * Parse the leading `---…---` YAML frontmatter from an mdast Root produced
 * with `remark-frontmatter`. Returns `{ data, bodyOffset }` where
 * `bodyOffset` is the character index after the closing `---` — slice the
 * original source from it to get the body without re-stringifying the tree.
 */
export const extractFrontmatter = (
  tree: Root,
): { data: Record<string, unknown>; bodyOffset: number } => {
  const node = tree.children.find((c): c is Yaml => c.type === 'yaml');
  if (!node) return { data: {}, bodyOffset: 0 };
  let parsed: unknown;
  try {
    parsed = yaml.load(node.value);
  } catch {
    return { data: {}, bodyOffset: node.position?.end.offset ?? 0 };
  }
  const data =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, bodyOffset: node.position?.end.offset ?? 0 };
};
