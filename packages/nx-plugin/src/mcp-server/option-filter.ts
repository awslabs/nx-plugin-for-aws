/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Predicate helpers shared between the MCP guide pipeline and the docs
 * site's client-side filter bar.
 *
 * The MDX parsing — scanning for OptionFilter / Infrastructure / TabItem
 * `_filter` blocks, handling nesting, rewriting the tree — is done using
 * unified + remark-mdx in `guide-pipeline.ts`. This file stays small and
 * contains just the value-level helpers needed to evaluate a predicate
 * against an options map, plus one regex-based scanner
 * (`collectReferencedKeys`) used by the docs site's filter bar to
 * enumerate referenced keys on a page without pulling tree-sitter into
 * the browser bundle.
 */

export type FilterValue = string | number | boolean;
export type Predicate = Record<string, string[]>;

/**
 * Parse the inside of a `when={{…}}` / `_filter={{…}}` attribute value.
 *
 * The JSX outer-brace wrapper has already been consumed by the MDX parser,
 * so the expression we receive is the object literal itself:
 *     { computeType: 'Rest', auth: ['IAM', 'Cognito'] }
 *
 * We intentionally accept only string / number / boolean / array-of-scalar
 * literals so we never evaluate arbitrary JavaScript — the docs site runs
 * these predicates in the browser and the MCP server runs them inside the
 * user's shell.
 */
export const parseWhenExpression = (expression: string): Predicate => {
  const trimmed = expression.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(
      `[option-filter] Expected object literal in 'when' prop, got: ${expression}`,
    );
  }
  const body = trimmed.slice(1, -1).trim();
  if (body === '') return {};

  const result: Predicate = {};
  for (const raw of splitTopLevelCommas(body)) {
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

/**
 * Evaluate a predicate against a set of selected options.
 *
 *   - A key with no entry in `options` is "no opinion" — inert for that key.
 *   - A key with a value must match one of the predicate's allowed values.
 *   - Multiple predicate keys are ANDed; array values within a key are ORed.
 *   - `not` negates the final boolean.
 *   - A predicate with no keys in common with `options` short-circuits true.
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
    if (selected === undefined) continue;
    anyKeyTested = true;
    if (!values.includes(selected)) {
      matched = false;
      break;
    }
  }
  if (!anyKeyTested) return true;
  return not ? !matched : matched;
};

/**
 * Render a short human label for a predicate, used on the docs site pill
 * and in the MCP server's `> [!NOTE] Only when …` marker when no options
 * are supplied.
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
 * Collect every option key referenced by `<OptionFilter when={{…}}>` blocks
 * in a raw MDX source. Used by the docs site's filter bar to decide which
 * dropdowns to render for a given guide page.
 *
 * Uses a tolerant regex because this runs at dev-server startup and must
 * cope with partially-typed MDX. The MCP server side uses the full AST
 * via unified/remark-mdx — this is just a fast build-time probe.
 */
export const collectReferencedKeys = (text: string): string[] => {
  const keys = new Set<string>();
  const OPEN = /<OptionFilter\b/g;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(text)) !== null) {
    const whenIdx = text.indexOf('when', m.index + m[0].length);
    if (whenIdx < 0) continue;
    const eqIdx = text.indexOf('=', whenIdx);
    if (eqIdx < 0) continue;
    let i = eqIdx + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{') continue;
    let depth = 0;
    let j = i;
    let quote: string | undefined;
    while (j < text.length) {
      const ch = text[j];
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
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
      j++;
    }
    const exprOuter = text.slice(i + 1, j - 1).trim();
    try {
      const pred = parseWhenExpression(exprOuter);
      for (const k of Object.keys(pred)) keys.add(k);
    } catch {
      // Partially-typed / malformed — skip.
    }
  }
  return [...keys];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
