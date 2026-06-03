/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
module.exports = {
  '{packages,e2e,docs}/**/*.{ts,tsx,js,json,css,scss}': [
    'biome check --write --no-errors-on-unmatched',
  ],
  '*.{js,json}': ['biome check --write --no-errors-on-unmatched'],
};
