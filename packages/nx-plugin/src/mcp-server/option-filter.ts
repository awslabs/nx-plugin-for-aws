/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Predicate helpers for `<OptionFilter when>` / `<TabItem _filter>`.
 * Parses the estree AST that remark-mdx attaches to each attribute value
 * — we never evaluate arbitrary JS; only string/number/boolean literals and
 * arrays of them are allowed so the same helpers can run in the browser
 * and in the user's shell.
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
 * Turn the `data.estree` of an `MdxJsxAttributeValueExpression` into a
 * `Predicate`. The estree is a Program wrapping a single ObjectExpression.
 */
export const parseWhenExpression = (estree: EstreeNode): Predicate => {
  const expression = unwrapProgram(estree);
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
    result[extractKey(prop)] = extractValues(prop.value);
  }
  return result;
};

/**
 * AND across keys, OR within a key's values, `not` negates. A key not
 * present in `options` is "no opinion". A predicate whose keys have no
 * intersection with `options` short-circuits to true.
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

/** Short human label used on the docs pill and in the `> [!NOTE] Only when …` marker. */
export const describePredicate = (
  predicate: Predicate,
  not: boolean,
): string => {
  const parts = Object.entries(predicate).map(
    ([k, vs]) => `${k} = ${vs.join(' | ')}`,
  );
  return `${not ? 'Not when ' : 'Only when '}${parts.join(', ')}`;
};

const unwrapProgram = (estree: EstreeNode): EstreeNode => {
  if (estree.type !== 'Program') return estree;
  const program = estree as Program;
  if (program.body.length !== 1) return estree;
  const stmt = program.body[0];
  return stmt.type === 'ExpressionStatement'
    ? (stmt.expression as EstreeNode)
    : estree;
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

/**
 * Extract a `string[]` from the estree of an attribute-value expression
 * like `{['a', 'b']}`. Used by JSX attribute readers (e.g. the
 * `commands={[...]}` prop on <NxCommands>). Throws if anything other than
 * string / number / boolean literal array elements are encountered.
 */
export const extractStringArrayExpression = (estree: EstreeNode): string[] => {
  const expression = unwrapProgram(estree);
  if (expression.type !== 'ArrayExpression') {
    throw new Error(
      `[option-filter] Expected array literal, got ${expression.type}`,
    );
  }
  const arr = expression as ArrayExpression;
  return arr.elements.map((el) => {
    if (el === null || el.type === 'SpreadElement') {
      throw new Error(`[option-filter] Unsupported array element`);
    }
    return extractScalar(el);
  });
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
