/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { smokeTest } from './smoke-test';
import { activatePackageManagerViaCorepack } from './corepack';

// Hardened mode + immutable installs are auto-enabled under CI and would
// refuse the lockfile mutations our fresh-workspace install needs.
smokeTest('yarn', {
  variant: 'yarn-4',
  setup: () =>
    activatePackageManagerViaCorepack('yarn', 4, {
      YARN_ENABLE_HARDENED_MODE: '0',
      YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
    }),
  onProjectCreate: (projectRoot) => {
    appendFileSync(
      join(projectRoot, '.yarnrc.yml'),
      '\nnpmMinimalAgeGate: "0"\n',
    );
  },
});
