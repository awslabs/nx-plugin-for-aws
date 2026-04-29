/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Predicate helpers shared between the MCP guide pipeline and the docs
 * site's server-rendered filter bar.
 *
 * Parsing of `<OptionFilter>` blocks is driven by unified + remark-mdx —
 * `parseWhenExpression` consumes the estree AST attached to the
 * `mdxJsxAttributeValueExpression` node, not the raw string. The helpers
 * here stay small and deal only with predicate evaluation and rendering.
 */

import type {
  ArrayExpression,
  Literal,
  Node as EstreeNode,
  Program,
  Property,
} from 'estree';

export type Predicate = Record<string, string[]>;

/**
 * Parse the estree AST of a `when={{…}}` / `_filter={{…}}` JSX attribute
 * value into a `Predicate`. The estree is the `data.estree` payload that
 * remark-mdx attaches to every `MdxJsxAttributeValueExpression` node — a
 * `Program` whose body is a single `ExpressionStatement` wrapping an
 * `ObjectExpression`.
 *
 * We accept only string / number / boolean literal values (or arrays of
 * them) so we never evaluate arbitrary JavaScript: the predicate is
 * consumed by the docs site in the browser and by the MCP server in the
 * user's shell.
 */
export const parseWhenExpression = (estree: EstreeNode): Predicate => {
  const expression = extractExpression(estree);
  if (expression.type !== 'ObjectExpression') {
    throw new Error(
      `[option-filter] Expected object literal in 'when' prop, got ${expression.type}`,
    );
  }
  const result: Predicate = {};
  for (const prop of expression.properties) {
    if (prop.type !== 'Property') {
      throw new Error(
        `[option-filter] Unsupported entry type '${prop.type}' in 'when' prop`,
      );
    }
    const key = extractKey(prop);
    result[key] = extractValues(prop.value);
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const extractExpression = (estree: EstreeNode): EstreeNode => {
  // remark-mdx wraps the attribute expression in a Program with a single
  // ExpressionStatement. Unwrap it so callers see the object literal
  // directly.
  if (estree.type === 'Program') {
    const program = estree as Program;
    if (program.body.length === 1) {
      const stmt = program.body[0];
      if (stmt.type === 'ExpressionStatement') {
        return stmt.expression as EstreeNode;
      }
    }
  }
  return estree;
};

const extractKey = (prop: Property): string => {
  const k = prop.key;
  if (k.type === 'Identifier') return k.name;
  if (k.type === 'Literal' && typeof k.value === 'string') return k.value;
  throw new Error(
    `[option-filter] Unsupported key type '${k.type}' in 'when' prop`,
  );
};

const extractValues = (value: Property['value']): string[] => {
  if (value.type === 'ArrayExpression') {
    const arr = value as ArrayExpression;
    return arr.elements.map((el) => {
      if (el === null || el.type === 'SpreadElement') {
        throw new Error(
          `[option-filter] Unsupported array element in 'when' prop`,
        );
      }
      return extractScalar(el);
    });
  }
  return [extractScalar(value)];
};

const extractScalar = (node: EstreeNode): string => {
  if (node.type === 'Literal') {
    const lit = node as Literal;
    if (
      typeof lit.value === 'string' ||
      typeof lit.value === 'number' ||
      typeof lit.value === 'boolean'
    ) {
      return String(lit.value);
    }
  }
  throw new Error(
    `[option-filter] Unsupported value type '${node.type}' in 'when' prop. ` +
      'Use string, number, boolean literals or arrays of them.',
  );
};
