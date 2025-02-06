/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
module.exports = {
  '{packages,e2e,docs}/**/*.{ts,tsx,js,json,md,html,css,scss}': [
    'pnpm nx affected --target lint --uncommitted --fix true',
    'pnpm nx format:write --uncommitted',
  ],
  '*.{js,md,json}': ['pnpm nx format:write --uncommitted'],
};
