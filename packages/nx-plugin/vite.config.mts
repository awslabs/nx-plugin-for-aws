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
    pool: 'threads',
    poolOptions: {
      threads: {
        isolate: false,
      },
    },
    sequence: {
      hooks: 'list',
    },
    testTimeout: 60000,
    hookTimeout: 60000,
    retry: 3,
    dangerouslyIgnoreUnhandledErrors: true
  },
});
