/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import spdxSatisfies from 'spdx-satisfies';
import type { AllowlistEntry, LicenseStatus } from './types';

export interface EvaluatorOptions {
  allow: AllowlistEntry[];
}

interface Evaluator {
  evaluate(rawLicense: string | undefined | null): LicenseStatus;
}

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
 * Strip the trailing `*` that license-checker adds when a license is guessed
 * from file content rather than declared in package.json metadata.
 */
const normalise = (raw: string): string => {
  let s = raw.trim();
  if (s.endsWith('*')) s = s.slice(0, -1).trim();
  return s;
};

/**
 * Build a flat list of valid SPDX IDs from the allowlist for use with
 * spdx-satisfies. Entries that aren't parseable as SPDX identifiers are
 * excluded (they're still matched via the alias lookup).
 */
const buildSpdxIds = (allow: AllowlistEntry[]): string[] => {
  const ids: string[] = [];
  for (const entry of allow) {
    if (!entry.spdxId) continue;
    try {
      spdxSatisfies(entry.spdxId, [entry.spdxId]);
      ids.push(entry.spdxId);
    } catch {
      // Not a valid SPDX identifier — skip for spdx-satisfies, still
      // matched via alias lookup
    }
  }
  return ids;
};

/**
 * Build a case-insensitive lookup for matching by full name or alias
 * (for licenses that aren't valid SPDX but appear in package metadata).
 */
const buildAliasLookup = (allow: AllowlistEntry[]): Map<string, true> => {
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

/**
 * Split a free-text license list on a separator, treating the operands as
 * alternatives (OR).
 *
 * Commas need care: several allowed license names contain one themselves (e.g.
 * "Apache License, Version 2.0"), so the string is left intact when it already
 * resolves as a single license, and fragments are otherwise rejoined
 * longest-match-first. That keeps "MIT License, Apache License, Version 2.0"
 * parsing as MIT + Apache rather than three unresolvable fragments.
 *
 * Returns `undefined` when the value shouldn't be treated as a list.
 */
const splitAlternatives = (
  value: string,
  separator: string,
  isKnown: (token: string) => boolean,
): string[] | undefined => {
  if (!value.includes(separator)) return undefined;
  if (isKnown(value)) return undefined;

  const parts = value
    .split(separator)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 2) return undefined;

  // Rejoin fragments that only make sense together, so a license name
  // containing the separator survives the split. At each position take the
  // longest run of fragments that forms a known license; failing that, emit the
  // single fragment and let the caller report it.
  const merged: string[] = [];
  let i = 0;
  while (i < parts.length) {
    let matchedTo = -1;
    let candidate = parts[i];
    for (let j = i; j < parts.length; j++) {
      if (j > i) candidate = `${candidate}${separator} ${parts[j]}`;
      if (isKnown(candidate)) matchedTo = j;
    }
    if (matchedTo >= 0) {
      merged.push(parts.slice(i, matchedTo + 1).join(`${separator} `));
      i = matchedTo + 1;
    } else {
      merged.push(parts[i]);
      i += 1;
    }
  }

  return merged.length > 1 ? merged : undefined;
};

const evaluateToken = (
  token: string,
  spdxIds: string[],
  aliasLookup: Map<string, true>,
): LicenseStatus => {
  const cleaned = normalise(token);
  if (isUnknownToken(cleaned)) return 'UNKNOWN';

  // Try spdx-satisfies for valid SPDX expressions
  try {
    if (spdxSatisfies(cleaned, spdxIds)) return 'PRE_APPROVED';
  } catch {
    // Not a valid SPDX expression — fall through to alias matching
  }

  // Fall back to alias/fullName matching for non-SPDX strings
  if (aliasLookup.has(cleaned.toLowerCase())) return 'PRE_APPROVED';

  return 'NOT_APPROVED';
};

export const createEvaluator = (options: EvaluatorOptions): Evaluator => {
  const spdxIds = buildSpdxIds(options.allow);
  const aliasLookup = buildAliasLookup(options.allow);

  return {
    evaluate(rawLicense) {
      if (!rawLicense || rawLicense.trim().length === 0) return 'UNKNOWN';

      const normalised = normalise(rawLicense);
      if (isUnknownToken(normalised)) return 'UNKNOWN';

      // Python tooling emits free-text license lists rather than an SPDX
      // expression: "Apache Software License; BSD License" (setuptools
      // classifiers) or "MIT License, Apache License, Version 2.0" (a dual
      // license declared in one `License:` field). Both mean "any of these
      // applies", so treat the operands as OR.
      const isKnown = (token: string) =>
        evaluateToken(token, spdxIds, aliasLookup) === 'PRE_APPROVED';
      for (const separator of [';', ',']) {
        const parts = splitAlternatives(normalised, separator, isKnown);
        if (!parts) continue;
        for (const part of parts) {
          if (evaluateToken(part, spdxIds, aliasLookup) === 'PRE_APPROVED')
            return 'PRE_APPROVED';
        }
        if (parts.every((p) => isUnknownToken(normalise(p)))) return 'UNKNOWN';
        return 'NOT_APPROVED';
      }

      return evaluateToken(normalised, spdxIds, aliasLookup);
    },
  };
};
