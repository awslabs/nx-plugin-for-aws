/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig, transformWithEsbuild } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Plugin which allows e2e tests to import .ts.template files from generators as if it were typescript
 * Useful for dogfooding generated code, such as clients for invoking deployed resources
 */
const importTypeScriptTemplatesAsVirtualModule = () => {
  const VIRTUAL_MODULE_PREFIX = 'virtual:ts-template/';

  const getTemplatePath = (id: string) => {
    const templatePath = id.replace(`\0${VIRTUAL_MODULE_PREFIX}`, '');
    return path.resolve(
      __dirname,
      '../packages/nx-plugin/src',
      `${templatePath}.ts.template`,
    );
  };

  return {
    name: 'ts-template-virtual-module',
    resolveId: (source) => {
      if (source.startsWith(VIRTUAL_MODULE_PREFIX)) {
        return `\0${source}`;
      }
    },
    load: (id) => {
      if (id.startsWith(`\0${VIRTUAL_MODULE_PREFIX}`)) {
        return fs.readFileSync(getTemplatePath(id), 'utf-8');
      }
    },
    transform: async (code, id) => {
      if (id.startsWith(`\0${VIRTUAL_MODULE_PREFIX}`)) {
        return await transformWithEsbuild(code, getTemplatePath(id), {
          loader: 'ts',
        });
      }
      return null;
    },
  };
};

export default defineConfig({
  root: __dirname,
  cacheDir: '../node_modules/.vite/e2e',
  plugins: [
    nxViteTsPaths(),
    nxCopyAssetsPlugin(['*.md']),
    importTypeScriptTemplatesAsVirtualModule(),
  ],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: [['default', { summary: false }]],
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
    testTimeout: 60 * 60 * 1000, /// 60 mins for long running e2e tests (eg deploy)
  },
});
