/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { dirname, join } from 'node:path';
import ts from 'typescript';

// Resolve nx's dynamicImport from its config-utils module by filesystem path.
// It is not part of @nx/devkit's exports map, but it ensures transpilers
// (namely @swc-node/register) leave the import untouched so node performs it at
// runtime, which allows importing data urls. package.json IS in the exports map.
const nxDevkitRoot = dirname(require.resolve('@nx/devkit/package.json'));
const { dynamicImport } = require(
  join(nxDevkitRoot, 'dist/src/utils/config-utils'),
) as {
  dynamicImport: (modulePath: string) => Promise<Record<string, unknown>>;
};

/**
 * Imports a javascript module from a string of js code
 */
export const importJavaScriptModule = async <T>(jsCode: string): Promise<T> => {
  const module = await dynamicImport(
    `data:text/javascript,${encodeURIComponent(jsCode)}`,
  );

  // Return the default export if available, otherwise the full module
  return (module.default ?? module) as T;
};

/**
 * Imports a typescript module from a string of typescript code
 */
export const importTypeScriptModule = async <T>(tsCode: string): Promise<T> => {
  // Transpile to js and then import as a js module
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  return await importJavaScriptModule<T>(jsCode);
};
