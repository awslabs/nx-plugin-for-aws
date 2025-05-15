/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { inject } from 'vitest';
import mock from 'mock-require';

const graph = inject('nxGraph');

// @nx/devkit is required so we can't mock it with vi.mock
mock('@nx/devkit', {
  ...require('@nx/devkit'),
  // Mock the project graph with the one we already computed
  createProjectGraphAsync: async () => graph,
});
