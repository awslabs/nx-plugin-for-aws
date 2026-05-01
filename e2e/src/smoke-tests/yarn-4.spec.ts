/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smokeTest } from './smoke-test';
import { activateYarnViaCorepack } from './yarn-corepack';

smokeTest('yarn', {
  variant: 'yarn-4',
  setup: () => activateYarnViaCorepack('4.14.1'),
});
