/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-exports internal modules from @nxlv/python that are not exposed
 * via the package's "exports" field.
 *
 * Newer versions of Node.js and Vite strictly enforce the "exports" map
 * in package.json, which prevents deep imports like:
 *   import { UVProvider } from '@nxlv/python/dist/provider/uv/provider'
 *
 * This module resolves the package location and loads the internal modules
 * directly by filesystem path, bypassing the exports restriction.
 */
import path from 'path';

// Resolve the @nxlv/python package root by finding its package.json
// (which IS listed in the exports map as "./package.json")
const nxlvPythonPkgJson = require.resolve('@nxlv/python/package.json');
const nxlvPythonRoot = path.dirname(nxlvPythonPkgJson);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const uvProviderModule = require(
  path.join(nxlvPythonRoot, 'dist/provider/uv/provider'),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loggerModule = require(
  path.join(nxlvPythonRoot, 'dist/executors/utils/logger'),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migrateToSharedVenvModule = require(
  path.join(nxlvPythonRoot, 'dist/generators/migrate-to-shared-venv/generator'),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const uvProjectModule = require(
  path.join(nxlvPythonRoot, 'dist/generators/uv-project/generator'),
);

export const UVProvider: typeof import('@nxlv/python/dist/provider/uv/provider').UVProvider =
  uvProviderModule.UVProvider;

// Type-only export — resolved by TypeScript at compile time using classic
// "node" moduleResolution, which does not enforce the exports map.
export type UVPyprojectToml =
  import('@nxlv/python/dist/provider/uv/types').UVPyprojectToml;

export const Logger: typeof import('@nxlv/python/dist/executors/utils/logger').Logger =
  loggerModule.Logger;

export const migrateToSharedVenvGenerator: typeof import('@nxlv/python/dist/generators/migrate-to-shared-venv/generator').default =
  migrateToSharedVenvModule.default ?? migrateToSharedVenvModule;

export const uvProjectGenerator: typeof import('@nxlv/python/dist/generators/uv-project/generator').default =
  uvProjectModule.default ?? uvProjectModule;
