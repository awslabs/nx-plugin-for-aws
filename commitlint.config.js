/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
const conventional = require('@commitlint/config-conventional');

const [, , conventionalTypes] = (conventional.default ?? conventional).rules[
  'type-enum'
];

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // `deps` releases a patch for dependency versions vended to users — see the
    // conventionalCommits types in nx.json.
    'type-enum': [2, 'always', [...conventionalTypes, 'deps']],
  },
};
