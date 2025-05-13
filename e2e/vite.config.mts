/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';
export default defineConfig({
  root: __dirname,
  cacheDir: '../node_modules/.vite/e2e',
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
    reporters: ['basic'],
    disableConsoleIntercept: true,
    fileParallelism: false,
    globalSetup: 'src/global-setup.ts',
    coverage: { reportsDirectory: '../coverage/e2e', provider: 'v8' },
    pool: 'threads',
    poolOptions: {
      threads: {
        isolate: true,
        singleThread: true,
      },
    },
    testTimeout: 10 * 60 * 1000, /// 10 mins
  },
});
