/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smokeTest } from './smoke-test';
import { activatePackageManagerViaCorepack } from './corepack';

smokeTest('yarn', {
  variant: 'yarn-classic',
  setup: () => activatePackageManagerViaCorepack('yarn', 1),
});
