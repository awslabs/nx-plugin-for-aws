/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/nx-plugin',

  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },

  test: {
    env: {
      NX_DAEMON: 'false',
      NX_NATIVE_LOGGING: 'error',
      GRIT_GLOBAL_DIR: '/tmp/.grit',
    },
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/utils/mock-project-graph.ts'],
    globalSetup: ['src/utils/test/warm-python-cache.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/packages/nx-plugin',
      provider: 'v8',
      enabled: true,
      reporter: ['lcov'],
    },
    sequence: {
      hooks: 'list',
    },
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
