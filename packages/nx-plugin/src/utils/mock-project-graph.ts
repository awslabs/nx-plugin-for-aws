/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mock createProjectGraphAsync to avoid expensive project graph building in tests.
 *
 * This is the vitest equivalent of Nx's own internal testing utility:
 * https://github.com/nrwl/nx/blob/master/packages/nx/src/internal-testing-utils/mock-project-graph.ts
 *
 * We patch the underlying nx module directly because:
 * 1. vitest's vi.mock only affects ESM imports within the test file
 * 2. @nx/devkit's exports are wrapped with read-only getters by vitest
 * 3. The CJS module at nx/src/project-graph/project-graph.js is the actual
 *    implementation that @nx/devkit re-exports
 */
import { createRequire } from 'module';

// @ts-expect-error test utility used by vite only
const _require = createRequire(import.meta.url);
const projectGraph = _require('nx/src/project-graph/project-graph');
projectGraph.createProjectGraphAsync = async () => ({
  nodes: {},
  dependencies: {},
});
