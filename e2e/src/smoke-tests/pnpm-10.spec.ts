/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { activatePackageManagerViaCorepack } from './corepack';
import { smokeTest } from './smoke-test';

smokeTest('pnpm', {
  variant: 'pnpm-10',
  setup: () => activatePackageManagerViaCorepack('pnpm', 10),
});
