/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import nxPlugin from '@nx/eslint-plugin';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const jsoncParser = require('jsonc-eslint-parser');

export default [
  {
    ignores: ['node_modules', '.docusaurus', '**/package.json'],
  },
  ...nxPlugin.configs['flat/base'],
  ...nxPlugin.configs['flat/typescript'],
  ...nxPlugin.configs['flat/javascript'],
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {},
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.spec.js', '**/*.spec.jsx'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
];
