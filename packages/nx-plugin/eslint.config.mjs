/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import baseConfig from '../../eslint.config.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const localCustomRules = require('eslint-plugin-local-custom-nx-plugin-for-aws-rules');
const jsoncParser = require('jsonc-eslint-parser');

export default [
  ...baseConfig,
  {
    plugins: {
      'local-custom-nx-plugin-for-aws-rules': localCustomRules,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    languageOptions: {
      parserOptions: {
        project: ['packages/nx-plugin/tsconfig.*?.json'],
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'local-custom-nx-plugin-for-aws-rules/require-mcp-js-extension': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.jsx'],
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
          ignoredFiles: ['**/*.spec.ts', '**/*.spec.tsx'],
        },
      ],
    },
  },
  {
    files: ['./package.json', './generators.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      '@nx/nx-plugin-checks': 'error',
    },
  },
];
