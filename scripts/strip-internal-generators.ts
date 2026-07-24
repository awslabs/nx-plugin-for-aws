/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Removes generators marked `"internal": true` from the compiled
 * `generators.json` so they ship only in-repo, not in the published package.
 * Internal generators (e.g. `nx-migration`) are contributor tooling resolved
 * from source via the workspace tsconfig path; users never run them. Runs as
 * part of the nx-plugin `package` target, after `compile` copies the asset.
 */

const DIST_GENERATORS_PATH = 'dist/packages/nx-plugin/generators.json';

interface GeneratorsJson {
  generators?: Record<string, { internal?: boolean }>;
}

const main = () => {
  const generatorsJson: GeneratorsJson = JSON.parse(
    readFileSync(DIST_GENERATORS_PATH, 'utf-8'),
  );

  const entries = Object.entries(generatorsJson.generators ?? {});
  const kept = entries.filter(([, entry]) => !entry.internal);
  const removed = entries.length - kept.length;

  writeFileSync(
    DIST_GENERATORS_PATH,
    `${JSON.stringify(
      { ...generatorsJson, generators: Object.fromEntries(kept) },
      null,
      2,
    )}\n`,
    'utf-8',
  );
  console.log(
    `Stripped ${removed} internal generator(s) from ${DIST_GENERATORS_PATH}`,
  );
};

main();
