/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { activatePackageManagerViaCorepack } from './corepack';
import { smokeTest } from './smoke-test';

// Pinned rather than tracking the 12 line: 12.3.2 shipped without a
// `@pnpm/exe.linux-x64` build, so corepack 404s activating it on Linux.
smokeTest('pnpm', {
  variant: 'pnpm-12',
  setup: () => activatePackageManagerViaCorepack('pnpm', '12.3.1'),
});
