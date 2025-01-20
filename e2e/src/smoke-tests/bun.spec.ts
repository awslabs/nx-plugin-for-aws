/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFileSync } from 'fs';
import { smokeTest } from './smoke-test';
smokeTest('bun', (projectRoot) => {
  writeFileSync(
    `${projectRoot}/bunfig.toml`,
    `[install]\nregistry = "${process.env.npm_config_registry}"\n\n[install.cache]\ndisable = true\ndisableManifest = true`,
    { encoding: 'utf-8' }
  );
});
