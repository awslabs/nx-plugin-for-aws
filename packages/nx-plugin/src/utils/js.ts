/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import ts from 'typescript';
import { dynamicImport } from '@nx/devkit/src/utils/config-utils';

/**
 * Imports a javascript module from a string of js code
 */
export const importJavaScriptModule = async <T>(jsCode: string): Promise<T> => {
  // Use nx's dynamic import to ensure that transpilers (namely @swc-node/register) don't process the import and it's
  // instead processed by node at runtime, which allows for data urls
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
