/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AllowlistEntry, LicenseStatus } from './types';

export interface EvaluatorOptions {
  allow: AllowlistEntry[];
}

interface Evaluator {
  evaluate(rawLicense: string | undefined | null): LicenseStatus;
}

const stripWrappingParens = (input: string): string => {
  let s = input.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0 && i < s.length - 1) {
          balanced = false;
          break;
        }
      }
    }
    if (!balanced) return s;
    s = s.slice(1, -1).trim();
  }
  return s;
};

/**
 * Split a license expression on a top-level operator, ignoring operators inside parentheses.
 */
const splitOnOperator = (input: string, op: string): string[] | null => {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i <= input.length - op.length; i++) {
    const ch = input[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && input.slice(i, i + op.length) === op) {
      parts.push(input.slice(last, i).trim());
      last = i + op.length;
      i = last - 1;
    }
  }
  if (parts.length === 0) return null;
  parts.push(input.slice(last).trim());
  return parts;
};

const buildLookup = (allow: AllowlistEntry[]): Map<string, true> => {
  const m = new Map<string, true>();
  for (const e of allow) {
    if (e.spdxId) m.set(e.spdxId.toLowerCase(), true);
    if (e.fullName) m.set(e.fullName.toLowerCase(), true);
    for (const a of e.aliases ?? []) {
      if (a) m.set(a.toLowerCase(), true);
    }
  }
  return m;
};

const isUnknownToken = (raw: string): boolean => {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.toUpperCase() === 'UNKNOWN') return true;
  if (trimmed.toLowerCase().startsWith('custom:')) return true;
  if (trimmed.toLowerCase().startsWith('see license in')) return true;
  return false;
};

/**
 * Strip noise that license-checker adds when a license is guessed from text
 * rather than declared. `MIT*` means the license matched MIT by content
 * inspection — for our purposes that is equivalent to declaring MIT.
 */
const normaliseToken = (raw: string): string => {
  let s = raw.trim();
  if (s.endsWith('*')) s = s.slice(0, -1).trim();
  return s;
};

const evaluateToken = (
  token: string,
  allowLookup: Map<string, true>,
): LicenseStatus => {
  const cleaned = normaliseToken(token);
  if (isUnknownToken(cleaned)) return 'UNKNOWN';
  const key = cleaned.toLowerCase();
  if (allowLookup.has(key)) return 'PRE_APPROVED';
  return 'NOT_APPROVED';
};

/**
 * Evaluate an SPDX-like expression. Supports:
 * - Top-level `OR` — passes if any operand passes.
 * - Top-level `AND` — passes only if all operands pass.
 * - `;` separated lists (commonly emitted by Python tooling) — treated as OR.
 * - Surrounding parentheses.
 */
const evaluateExpression = (
  expr: string,
  allowLookup: Map<string, true>,
): LicenseStatus => {
  const stripped = stripWrappingParens(expr);

  const orParts = splitOnOperator(stripped, ' OR ');
  if (orParts) {
    const statuses = orParts.map((p) => evaluateExpression(p, allowLookup));
    if (statuses.some((s) => s === 'PRE_APPROVED')) return 'PRE_APPROVED';
    if (statuses.every((s) => s === 'UNKNOWN')) return 'UNKNOWN';
    return 'NOT_APPROVED';
  }

  const andParts = splitOnOperator(stripped, ' AND ');
  if (andParts) {
    const statuses = andParts.map((p) => evaluateExpression(p, allowLookup));
    if (statuses.every((s) => s === 'PRE_APPROVED')) return 'PRE_APPROVED';
    if (statuses.some((s) => s === 'UNKNOWN')) return 'UNKNOWN';
    return 'NOT_APPROVED';
  }

  // Python tooling sometimes emits "Apache Software License; BSD License" — a list.
  if (stripped.includes(';')) {
    const parts = stripped
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 1) {
      const statuses = parts.map((p) => evaluateExpression(p, allowLookup));
      if (statuses.some((s) => s === 'PRE_APPROVED')) return 'PRE_APPROVED';
      if (statuses.every((s) => s === 'UNKNOWN')) return 'UNKNOWN';
      return 'NOT_APPROVED';
    }
  }

  return evaluateToken(stripped, allowLookup);
};

export const createEvaluator = (options: EvaluatorOptions): Evaluator => {
  const allowLookup = buildLookup(options.allow);
  return {
    evaluate(rawLicense) {
      if (!rawLicense || rawLicense.trim().length === 0) return 'UNKNOWN';
      return evaluateExpression(rawLicense, allowLookup);
    },
  };
};
