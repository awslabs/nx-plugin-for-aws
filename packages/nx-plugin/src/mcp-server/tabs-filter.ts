/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  evaluatePredicate,
  parseWhenExpression,
  type Predicate,
} from './option-filter';

/**
 * Transform `<Tabs>` / `<TabItem>` blocks so MCP-served guides collapse to
 * the tab(s) relevant to the agent's selected `options`.
 *
 * On the docs site, all tabs stay visible — users can click between them.
 * For agents, however, irrelevant tabs are noise. Authors opt a Tabs group
 * into MCP-side filtering by adding an `_filter={{ key: 'value' }}` prop
 * to each `<TabItem>`:
 *
 *   <Tabs syncKey="http-rest">
 *     <TabItem label="REST API" _filter={{ computeType: 'ServerlessApiGatewayRestApi' }}>
 *       ...REST-specific content...
 *     </TabItem>
 *     <TabItem label="HTTP API" _filter={{ computeType: 'ServerlessApiGatewayHttpApi' }}>
 *       ...HTTP-specific content...
 *     </TabItem>
 *   </Tabs>
 *
 * When the agent passes matching `options`, only the matching TabItem bodies
 * survive (the `<Tabs>` / `<TabItem>` wrappers are stripped so the content
 * inlines cleanly). When options don't narrow to a single tab, or the
 * option key isn't supplied at all, every TabItem is kept — still inside
 * the original Tabs wrappers — so nothing is silently dropped.
 *
 * TabItems without a `_filter` attribute are always kept; Tabs groups with
 * no filtered TabItems are left untouched.
 */

const TABS_OPEN = '<Tabs';
const TABS_CLOSE = '</Tabs>';
const TAB_ITEM_OPEN = '<TabItem';
const TAB_ITEM_CLOSE = '</TabItem>';

const findTagEnd = (text: string, openIdx: number): number => {
  let i = openIdx + 1;
  let depth = 0;
  let quote: string | undefined;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i += 2;
      else {
        if (ch === quote) quote = undefined;
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      continue;
    }
    if (ch === '>' && depth === 0) return i;
    i++;
  }
  return -1;
};

interface TabsBlock {
  startIndex: number;
  endIndex: number;
  openTag: string;
  body: string;
}

interface TabItemBlock {
  startIndex: number;
  endIndex: number;
  openTag: string;
  body: string;
  predicate?: Predicate;
}

const scanTabs = (text: string): TabsBlock[] => {
  const blocks: TabsBlock[] = [];
  let i = 0;
  while (i < text.length) {
    const openIdx = text.indexOf(TABS_OPEN, i);
    if (openIdx === -1) break;
    const after = text.charAt(openIdx + TABS_OPEN.length);
    if (after !== ' ' && after !== '>' && after !== '\n' && after !== '\t') {
      i = openIdx + TABS_OPEN.length;
      continue;
    }
    const openEnd = findTagEnd(text, openIdx);
    if (openEnd === -1) break;
    const closeIdx = text.indexOf(TABS_CLOSE, openEnd + 1);
    if (closeIdx === -1) break;
    blocks.push({
      startIndex: openIdx,
      endIndex: closeIdx + TABS_CLOSE.length,
      openTag: text.slice(openIdx, openEnd + 1),
      body: text.slice(openEnd + 1, closeIdx),
    });
    i = closeIdx + TABS_CLOSE.length;
  }
  return blocks;
};

const scanTabItems = (body: string): TabItemBlock[] => {
  const items: TabItemBlock[] = [];
  let i = 0;
  while (i < body.length) {
    const openIdx = body.indexOf(TAB_ITEM_OPEN, i);
    if (openIdx === -1) break;
    const after = body.charAt(openIdx + TAB_ITEM_OPEN.length);
    if (after !== ' ' && after !== '>' && after !== '\n' && after !== '\t') {
      i = openIdx + TAB_ITEM_OPEN.length;
      continue;
    }
    const openEnd = findTagEnd(body, openIdx);
    if (openEnd === -1) break;
    const closeIdx = body.indexOf(TAB_ITEM_CLOSE, openEnd + 1);
    if (closeIdx === -1) break;

    const openTag = body.slice(openIdx, openEnd + 1);
    items.push({
      startIndex: openIdx,
      endIndex: closeIdx + TAB_ITEM_CLOSE.length,
      openTag,
      body: body.slice(openEnd + 1, closeIdx),
      predicate: readFilterProp(openTag),
    });
    i = closeIdx + TAB_ITEM_CLOSE.length;
  }
  return items;
};

/**
 * Extract the `_filter={{ key: 'value' }}` attribute from a TabItem opening
 * tag, returning an option-filter-compatible predicate. Returns undefined
 * when the attribute is absent or malformed.
 */
const readFilterProp = (openTag: string): Predicate | undefined => {
  // Locate `_filter={`, then capture the balanced braces up to the closing `}`.
  const attrIdx = openTag.indexOf('_filter');
  if (attrIdx < 0) return undefined;
  // Skip whitespace/equals to reach the opening brace.
  let i = attrIdx + '_filter'.length;
  while (i < openTag.length && /\s/.test(openTag[i])) i++;
  if (openTag[i] !== '=') return undefined;
  i++;
  while (i < openTag.length && /\s/.test(openTag[i])) i++;
  if (openTag[i] !== '{') return undefined;

  let depth = 1;
  let j = i + 1;
  let quote: string | undefined;
  while (j < openTag.length && depth > 0) {
    const ch = openTag[j];
    if (quote) {
      if (ch === '\\') j += 2;
      else {
        if (ch === quote) quote = undefined;
        j++;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      j++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    j++;
  }
  if (depth !== 0) return undefined;
  // The captured expression includes the JSX wrapper braces, e.g.
  //   `{{ computeType: 'Rest' }}`
  // Peel off the outer `{…}` JSX expression braces to hand
  // parseWhenExpression the object literal it expects.
  const expression = openTag.slice(i + 1, j - 1).trim();
  try {
    return parseWhenExpression(expression);
  } catch {
    return undefined;
  }
};

export const applyTabsFilter = (
  text: string,
  options?: Record<string, string>,
): string => {
  if (!options || Object.keys(options).length === 0) {
    // Nothing to narrow on — still strip `_filter={{…}}` props from the
    // source so they don't confuse downstream MDX consumers/readers.
    return stripFilterProps(text);
  }

  const blocks = scanTabs(text);
  if (blocks.length === 0) return stripFilterProps(text);

  let result = '';
  let cursor = 0;

  for (const block of blocks) {
    result += text.slice(cursor, block.startIndex);

    const items = scanTabItems(block.body);
    const filteredItems = items.filter((it) => it.predicate !== undefined);

    if (filteredItems.length === 0) {
      // No `_filter` hints — leave the Tabs group untouched.
      result += text.slice(block.startIndex, block.endIndex);
      cursor = block.endIndex;
      continue;
    }

    // Which filtered TabItems match the supplied options?
    const matching = items.filter(
      (it) => it.predicate && evaluatePredicate(it.predicate, false, options),
    );

    if (matching.length === 1) {
      // Unique match: strip the Tabs/TabItem wrappers and inline the body.
      result += matching[0].body.trim() + '\n';
    } else if (matching.length > 1) {
      // Multiple matches still relevant: keep the wrappers, include only
      // the matching items so the agent can see each variant.
      const rebuilt = matching
        .map(
          (it) =>
            `${stripFilterPropFromOpenTag(it.openTag)}${it.body}${TAB_ITEM_CLOSE}`,
        )
        .join('\n');
      result += `${block.openTag}\n${rebuilt}\n${TABS_CLOSE}`;
    } else {
      // No matches — the author marked every TabItem with a `_filter` but
      // none apply. Drop the whole Tabs block rather than leaving a stub.
    }
    cursor = block.endIndex;
  }
  result += text.slice(cursor);
  return stripFilterProps(result);
};

/**
 * Even when we leave a Tabs block alone, the `_filter={…}` prop is still
 * unknown to Starlight's TabItem and would render in MDX as-is. Strip it
 * from any surviving TabItem opening tag so the output stays clean.
 */
const stripFilterProps = (text: string): string =>
  text.replace(/(<TabItem\b[^>]*?)\s+_filter=\{(?:[^{}]|\{[^{}]*\})*\}/g, '$1');

const stripFilterPropFromOpenTag = (openTag: string): string =>
  openTag.replace(/\s+_filter=\{(?:[^{}]|\{[^{}]*\})*\}/, '');
