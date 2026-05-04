/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { smokeTest } from './smoke-test';
import { activatePnpmViaCorepack } from './pnpm-corepack';

smokeTest('pnpm', {
  variant: 'pnpm-11',
  setup: () => activatePnpmViaCorepack('11.0.4'),
});
