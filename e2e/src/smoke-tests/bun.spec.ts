/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFileSync } from 'fs';
import { smokeTest } from './smoke-test';

// The local verdaccio URL is set in global-setup.ts. It's the scoped registry
// only for @aws/* packages; everything else goes to npmjs.
const LOCAL_REGISTRY = process.env.NX_E2E_LOCAL_REGISTRY;

smokeTest('bun', (projectRoot) => {
  // Scope bun to the local verdaccio only for @aws/* packages so the rest of
  // the install goes straight to npmjs (matching the other smoke tests).
  // Disable the install cache so we don't reuse stale tarballs across runs.
  writeFileSync(
    `${projectRoot}/bunfig.toml`,
    [
      `[install]`,
      `registry = "https://registry.npmjs.org/"`,
      ``,
      `[install.scopes]`,
      `"@aws" = { url = "${LOCAL_REGISTRY}", token = "secretVerdaccioToken" }`,
      ``,
      `[install.cache]`,
      `disable = true`,
      `disableManifest = true`,
    ].join('\n'),
    { encoding: 'utf-8' },
  );
});
