/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import ts from 'typescript';

// A real runtime `import()`, wrapped in `new Function` so transpilers (tsc's
// CommonJS output, @swc-node/register) cannot rewrite it to `require()` —
// `require()` cannot load the `data:` urls we import below. Under a test VM
// (vitest) this `new Function` import has no dynamic-import callback, so we
// fall back to a literal `import()` which the test runner wires up correctly.
const nodeImport = new Function('modulePath', 'return import(modulePath);') as (
  modulePath: string,
) => Promise<Record<string, unknown>>;

const dynamicImport = async (
  modulePath: string,
): Promise<Record<string, unknown>> => {
  try {
    return await nodeImport(modulePath);
  } catch (e) {
    if (
      e instanceof TypeError &&
      e.message.includes('dynamic import callback')
    ) {
      return import(/* @vite-ignore */ modulePath);
    }
    throw e;
  }
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
