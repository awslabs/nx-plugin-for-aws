/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared utility for discovering, parsing, and filtering <OptionFilter> blocks
 * in MDX guide pages.
 *
 * Used by:
 *   - The MCP server's postProcessGuide to drop branches that don't match the
 *     agent-supplied `options` input, or annotate each branch with a marker
 *     when no options are supplied.
 *   - The docs site's build-time remark plugin to validate every predicate
 *     against the target generator's schema.
 *   - The docs site's filter bar to enumerate which option keys a page
 *     actually references.
 *
 * The scanner is stack-based (not regex) because OptionFilter tags may nest
 * and their `when={{…}}` props contain braces that defeat naive regex matching.
 */

export type FilterValue = string | number | boolean;
export type Predicate = Record<string, string[]>;

export interface OptionFilterBlock {
  predicate: Predicate;
  not: boolean;
  /**
   * Optional short human description from the `description` prop. Renders on
   * the pill and drives the MCP `FILTER — <desc>` marker.
   */
  description?: string;
  /** Original source text of the opening tag, e.g. <OptionFilter when={{…}}>. */
  openTag: string;
  /** Start index of the opening `<` in the source. */
  startIndex: number;
  /** End index (exclusive) of the closing `>` of </OptionFilter>. */
  endIndex: number;
  /** Slice of source between the opening `>` and closing `<`. */
  body: string;
  /** Nested OptionFilter blocks directly within this block. */
  children: OptionFilterBlock[];
}

const OPEN_TAG_NAME = '<OptionFilter';
const CLOSE_TAG = '</OptionFilter>';

/**
 * Find the matching close index for an element that may contain nested
 * elements with the same tag name.
 */
const findMatchingClose = (text: string, startFromOpenEnd: number): number => {
  let depth = 1;
  let i = startFromOpenEnd;
  while (i < text.length) {
    const nextOpen = text.indexOf(OPEN_TAG_NAME, i);
    const nextClose = text.indexOf(CLOSE_TAG, i);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Distinguish <OptionFilter ...> from <OptionFilterFoo>
      const ch = text.charAt(nextOpen + OPEN_TAG_NAME.length);
      if (ch === ' ' || ch === '>' || ch === '\n' || ch === '\t') {
        const innerOpenEnd = findTagEnd(text, nextOpen);
        if (innerOpenEnd === -1) return -1;
        depth++;
        i = innerOpenEnd + 1;
        continue;
      }
      // Not actually our tag — skip past this position.
      i = nextOpen + OPEN_TAG_NAME.length;
      continue;
    }
    depth--;
    if (depth === 0) {
      return nextClose + CLOSE_TAG.length;
    }
    i = nextClose + CLOSE_TAG.length;
  }
  return -1;
};

/**
 * Find the closing `>` of a JSX opening tag that starts at `openIdx`. Handles
 * braces inside attribute expressions.
 */
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
    if (ch === '>' && depth === 0) {
      return i;
    }
    i++;
  }
  return -1;
};

/**
 * Scan a guide text for every <OptionFilter> block at every nesting level.
 */
export const scanOptionFilters = (text: string): OptionFilterBlock[] => {
  const blocks: OptionFilterBlock[] = [];
  let i = 0;
  while (i < text.length) {
    const openIdx = text.indexOf(OPEN_TAG_NAME, i);
    if (openIdx === -1) break;
    const afterName = text.charAt(openIdx + OPEN_TAG_NAME.length);
    if (
      afterName !== ' ' &&
      afterName !== '>' &&
      afterName !== '\n' &&
      afterName !== '\t'
    ) {
      // Matched a longer name like <OptionFilterBar>; skip past.
      i = openIdx + OPEN_TAG_NAME.length;
      continue;
    }
    const openEnd = findTagEnd(text, openIdx);
    if (openEnd === -1) {
      throw new Error(
        `[option-filter] Could not find end of OptionFilter opening tag starting at index ${openIdx}`,
      );
    }
    const closeEnd = findMatchingClose(text, openEnd + 1);
    if (closeEnd === -1) {
      throw new Error(
        `[option-filter] Unterminated OptionFilter block starting at index ${openIdx}`,
      );
    }
    const openTag = text.slice(openIdx, openEnd + 1);
    const bodyStart = openEnd + 1;
    const bodyEnd = closeEnd - CLOSE_TAG.length;
    const body = text.slice(bodyStart, bodyEnd);

    const { predicate, not, description } = parseOptionFilterAttrs(openTag);

    blocks.push({
      predicate,
      not,
      description,
      openTag,
      startIndex: openIdx,
      endIndex: closeEnd,
      body,
      children: scanOptionFilters(body),
    });
    i = closeEnd;
  }
  return blocks;
};

/**
 * Read the attributes of an <OptionFilter ...> opening tag.
 */
export const parseOptionFilterAttrs = (
  openTag: string,
): { predicate: Predicate; not: boolean; description?: string } => {
  // Strip `<OptionFilter` and trailing `>` / `/>`.
  let attrText = openTag.trim();
  if (attrText.startsWith('<OptionFilter'))
    attrText = attrText.slice('<OptionFilter'.length);
  if (attrText.endsWith('/>')) attrText = attrText.slice(0, -2);
  else if (attrText.endsWith('>')) attrText = attrText.slice(0, -1);
  attrText = attrText.trim();

  let predicate: Predicate | undefined;
  let not = false;
  let description: string | undefined;

  // Attributes are a sequence of `name`, `name="value"`, or `name={expr}`.
  let i = 0;
  while (i < attrText.length) {
    while (i < attrText.length && /\s/.test(attrText[i])) i++;
    if (i >= attrText.length) break;

    // Read attribute name.
    const nameStart = i;
    while (i < attrText.length && /[A-Za-z0-9_-]/.test(attrText[i])) i++;
    const name = attrText.slice(nameStart, i);
    if (!name) {
      throw new Error(
        `[option-filter] Could not parse attributes in: ${openTag}`,
      );
    }
    while (i < attrText.length && /\s/.test(attrText[i])) i++;

    if (attrText[i] !== '=') {
      // Boolean attribute.
      if (name === 'not') not = true;
      continue;
    }
    i++; // skip '='
    while (i < attrText.length && /\s/.test(attrText[i])) i++;

    // Value is either "..." / '...' / {...}.
    const first = attrText[i];
    let value: string;
    if (first === '"' || first === "'") {
      const endQuote = attrText.indexOf(first, i + 1);
      if (endQuote === -1)
        throw new Error(`[option-filter] Unterminated string in: ${openTag}`);
      value = attrText.slice(i + 1, endQuote);
      i = endQuote + 1;
    } else if (first === '{') {
      let depth = 1;
      let j = i + 1;
      let quote: string | undefined;
      while (j < attrText.length && depth > 0) {
        const ch = attrText[j];
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
      value = attrText.slice(i + 1, j - 1);
      i = j;
    } else {
      throw new Error(
        `[option-filter] Expected attribute value for '${name}' in: ${openTag}`,
      );
    }

    if (name === 'when') {
      predicate = parseWhenExpression(value);
    } else if (name === 'not') {
      // `not={false}` / `not={true}` are honoured; non-boolean treated as true.
      not = !/^\s*false\s*$/.test(value);
    } else if (name === 'description') {
      // Accept either `description="..."` (already-unquoted) or
      // `description={'...'}` (JSX expression containing a string literal).
      const trimmed = value.trim();
      if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
      ) {
        description = trimmed.slice(1, -1);
      } else if (first === '"' || first === "'") {
        description = value;
      }
    }
  }

  if (!predicate) {
    throw new Error(
      `[option-filter] OptionFilter is missing a 'when={{…}}' prop: ${openTag}`,
    );
  }
  return { predicate, not, description };
};

/**
 * Parse the inside of a `when={{…}}` expression.
 *
 * The outer JSX braces are consumed by parseOptionFilterAttrs, so we expect a
 * single object literal like `{ key: 'value', key2: ['a', 'b'] }`. This
 * parser purposely accepts only string/number/boolean scalars (or arrays of
 * those) — not evaluation of arbitrary JS — because the docs site must not
 * execute user-supplied code and the MCP server runs on the user's machine.
 */
export const parseWhenExpression = (expression: string): Predicate => {
  const trimmed = expression.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(
      `[option-filter] Expected object literal in OptionFilter 'when' prop, got: ${expression}`,
    );
  }
  const body = trimmed.slice(1, -1).trim();
  if (body === '') return {};

  const result: Predicate = {};

  const segments = splitTopLevelCommas(body);
  for (const raw of segments) {
    const segment = raw.trim();
    if (!segment) continue;
    const colonIdx = indexOfUnquoted(segment, ':');
    if (colonIdx < 0) {
      throw new Error(
        `[option-filter] Expected 'key: value' entries in 'when' prop, got: ${segment}`,
      );
    }
    const key = unquote(segment.slice(0, colonIdx).trim());
    const valueRaw = segment.slice(colonIdx + 1).trim();
    result[key] = parseValue(valueRaw);
  }

  return result;
};

const indexOfUnquoted = (s: string, target: string): number => {
  let quote: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === target) return i;
  }
  return -1;
};

const unquote = (raw: string): string => {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseValue = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevelCommas(inner).map((v) => parseScalar(v.trim()));
  }
  return [parseScalar(trimmed)];
};

const splitTopLevelCommas = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
};

const parseScalar = (raw: string): string => {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true' || trimmed === 'false') return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  throw new Error(
    `[option-filter] Unsupported value '${trimmed}' in 'when' prop. Use string, array, number, or boolean literals.`,
  );
};

/**
 * Evaluate a predicate against a set of selected options.
 *
 * Semantics (docs-site filter bar — "All" is the default per key):
 *   - A key with no entry in `options` means the user hasn't narrowed on
 *     that option yet, so the block is shown.
 *   - A key with a value must match one of the predicate's allowed values.
 *   - Multiple keys in the predicate are ANDed.
 *   - Array values within a key are ORed.
 *   - `not` negates the final boolean.
 *
 * MCP callers pass a fully-chosen `options` map, so this naturally filters
 * down to the combination the agent selected. Callers that want strict
 * matching (every predicate key must be explicitly selected) can filter
 * their own input before calling.
 */
export const evaluatePredicate = (
  predicate: Predicate,
  not: boolean,
  options: Record<string, string>,
): boolean => {
  let matched = true;
  let anyKeyTested = false;
  for (const [key, values] of Object.entries(predicate)) {
    const selected = options[key];
    if (selected === undefined) continue; // "All" for this key — doesn't veto.
    anyKeyTested = true;
    if (!values.includes(selected)) {
      matched = false;
      break;
    }
  }
  // If the user has no opinion on any of the predicate's keys, show the
  // block. This also short-circuits `not` — otherwise a `not` block would
  // hide in the "All" default, which is surprising.
  if (!anyKeyTested) return true;
  return not ? !matched : matched;
};

/**
 * Render a short human label for an OptionFilter block, used both on the
 * docs site pill and in the MCP server's NOTE marker when no options are
 * supplied.
 */
export const describePredicate = (
  predicate: Predicate,
  not: boolean,
): string => {
  const parts = Object.entries(predicate).map(
    ([k, vs]) => `${k} = ${vs.join(' | ')}`,
  );
  return `${not ? 'Not when ' : 'Only when '}${parts.join(', ')}`;
};

/**
 * Collect every option key referenced by <OptionFilter> blocks on a page.
 */
export const collectReferencedKeys = (text: string): string[] => {
  const keys = new Set<string>();
  const walk = (blocks: OptionFilterBlock[]) => {
    for (const b of blocks) {
      for (const k of Object.keys(b.predicate)) keys.add(k);
      walk(b.children);
    }
  };
  walk(scanOptionFilters(text));
  return [...keys];
};

/**
 * Apply option filtering to a guide text.
 *
 * When `options` is provided:
 *   - Blocks whose predicate matches are unwrapped (body inlined).
 *   - Blocks whose predicate doesn't match are removed entirely.
 *
 * When `options` is omitted:
 *   - Every block is kept, prefixed with a `> [!NOTE] Only when …` marker so
 *     consumers (agents, readers of the raw markdown) can see the branch
 *     condition even without selecting options.
 */
export const applyOptionFilter = (
  text: string,
  options?: Record<string, string>,
): string => {
  // Process recursively: handle children first so any enclosing filter sees
  // the already-filtered body and we don't re-scan the same positions.
  const walk = (input: string): string => {
    const blocks = scanOptionFilters(input);
    if (blocks.length === 0) return input;

    let result = '';
    let cursor = 0;
    for (const block of blocks) {
      // Emit text before this block unchanged.
      result += input.slice(cursor, block.startIndex);

      const filteredBody = walk(block.body);

      if (options) {
        if (evaluatePredicate(block.predicate, block.not, options)) {
          result += filteredBody;
        }
        // else: drop the entire block, no output.
      } else {
        const label = describePredicate(block.predicate, block.not);
        const quoted = filteredBody
          .split('\n')
          .map((line) => (line.length === 0 ? '>' : `> ${line}`))
          .join('\n');
        result += `> [!NOTE] ${label}\n${quoted}`;
      }

      cursor = block.endIndex;
    }
    result += input.slice(cursor);
    return result;
  };

  return walk(text);
};
