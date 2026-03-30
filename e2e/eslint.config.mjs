/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import baseConfig from '../eslint.config.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const jsoncParser = require('jsonc-eslint-parser');

export default [
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {},
  },
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
          ],
        },
      ],
    },
  },
];
