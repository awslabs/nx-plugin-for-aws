/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/// <reference types='vitest' />
import { defineConfig } from 'vite';

import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/nx-plugin',

  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],

  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },

  test: {
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/packages/nx-plugin',
      provider: 'v8',
      enabled: true,
      reporter: ['lcov'],
    },
    env: {
      NX_DAEMON: 'true',
    },
    pool: 'threads',
    // Tests that use the ts library generator end up with Nx computing a project
    // graph on the daemon (the eslint generator calls createProjectGraphAsync).
    // Too much parallelism spams the daemon too hard causing it to deadlock on
    // less powerful machines, ie our CI worker, so we reduce it in CI mode.
    ...(process.env.CI
      ? {
          poolOptions: {
            threads: {
              minThreads: 1,
              maxThreads: 4,
            },
          },
        }
      : {}),
    sequence: {
      hooks: 'list',
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
