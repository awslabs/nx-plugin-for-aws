/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { coerce, gt, validRange } from 'semver';

/**
 * Whether the vended version is a strict upgrade on the declared one.
 *
 * Only an exact declared version is upgraded: a range is the user's choice, and
 * a reference (`catalog:`, `workspace:*`, a tag) holds its version elsewhere.
 *
 * Used for Python pins, Terraform providers and catalog entries no manifest
 * references. TypeScript dependencies go through devkit instead.
 */
export const isVendedUpgrade = (vended: string, declared: string): boolean => {
  const vendedParsed = coerce(vended, { includePrerelease: true });
  if (!vendedParsed) {
    return false;
  }
  if (!isSemverRange(declared)) {
    return false;
  }
  const declaredParsed = parseExact(declared);
  return declaredParsed ? gt(vendedParsed, declaredParsed) : false;
};

/** Empty is `*` to semver, so it is excluded explicitly. */
const isSemverRange = (specifier: string): boolean => {
  const trimmed = specifier.trim();
  return trimmed.length > 0 && validRange(trimmed) !== null;
};

/** Coerce only an exact version, leaving ranges unparsed. */
const parseExact = (specifier: string) => {
  const trimmed = specifier.trim();
  if (/[\s|^~><*]|\|\||:/.test(trimmed)) {
    return null;
  }
  return coerce(trimmed, { includePrerelease: true });
};
