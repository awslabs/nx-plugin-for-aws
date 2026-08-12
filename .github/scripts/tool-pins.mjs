/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';

/**
 * Prints the tool pins CI needs to make the Smithy CLI available, as
 * `name=value` lines for `$GITHUB_OUTPUT`.
 *
 * Read out of `versions.ts` by regex rather than imported: this runs before
 * `pnpm i`, so there is no tsx to load the module with. Parsed from the same
 * file the generators read so the runner cannot pin a different Smithy CLI than
 * the one a generated project's build resolves.
 *
 * Usage: node .github/scripts/tool-pins.mjs
 */

const VERSIONS_FILE = 'packages/nx-plugin/src/utils/versions.ts';

const source = readFileSync(VERSIONS_FILE, 'utf-8');

/**
 * Extracts a pin declared as a top-level entry of one of the version maps.
 * Anchored to the start of a line so a substring match elsewhere in the file
 * (`@smithy/*` npm packages, Maven coordinates) cannot satisfy it, and required
 * to match exactly once so a second declaration is an error rather than a
 * silently-picked first hit.
 */
const readPin = (name) => {
  const matches = [
    ...source.matchAll(new RegExp(`^  ${name}: '([^']+)',$`, 'gm')),
  ];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one \`${name}\` pin in ${VERSIONS_FILE}, found ${matches.length}`,
    );
  }
  return matches[0][1];
};

console.log(`smithy-version=${readPin('smithy')}`);
console.log(`mise-version=${readPin('mise')}`);
