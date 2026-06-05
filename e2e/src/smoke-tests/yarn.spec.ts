/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { activatePackageManagerViaCorepack } from './corepack';
import { smokeTest } from './smoke-test';

smokeTest('yarn', {
  variant: 'yarn-classic',
  setup: () => activatePackageManagerViaCorepack('yarn', 1),
});
