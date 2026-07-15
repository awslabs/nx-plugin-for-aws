/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `tsconfig.base.json` compiler options the plugin's TypeScript projects
 * rely on (project references, ESM, emit-less typecheck). Mirrors what
 * `@nx/js` `initGenerator` produces for a fresh TS-solution workspace.
 *
 * Kept dependency-free so the docs site can import it directly and render the
 * options without them drifting from what the generator writes.
 */
export const BASE_TSCONFIG_COMPILER_OPTIONS = {
  composite: true,
  declarationMap: true,
  emitDeclarationOnly: true,
  importHelpers: true,
  isolatedModules: true,
  lib: ['es2022'],
  module: 'nodenext',
  moduleResolution: 'nodenext',
  noEmitOnError: true,
  noFallthroughCasesInSwitch: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noUnusedLocals: true,
  skipLibCheck: true,
  strict: true,
  target: 'es2022',
};
