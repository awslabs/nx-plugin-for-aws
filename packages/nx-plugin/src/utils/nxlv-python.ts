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
 *
 * Type definitions are inlined from the @nxlv/python .d.ts files because
 * moduleResolution: "bundler" does not allow deep path type imports for
 * packages without proper exports.
 */
import { Tree } from '@nx/devkit';
import path from 'path';

// ---------------------------------------------------------------------------
// Inlined types from @nxlv/python (sourced from dist/**\/*.d.ts)
// ---------------------------------------------------------------------------

export type UVPyprojectTomlIndex = {
  name: string;
  url: string;
};

export type UVPyprojectToml = {
  project?: {
    name: string;
    version: string;
    dependencies: string[];
    'optional-dependencies': {
      [key: string]: string[];
    };
  };
  'dependency-groups': {
    [key: string]: string[];
  };
  'build-system'?: {
    requires?: string[];
    'build-backend'?: string;
  };
  tool?: {
    hatch?: {
      build?: {
        targets?: {
          wheel?: {
            packages: string[];
          };
        };
      };
      metadata?: {
        'allow-direct-references'?: boolean;
      };
    };
    uv?: {
      sources?: {
        [key: string]: {
          path?: string;
          workspace?: boolean;
          index?: string;
        };
      };
      index?: UVPyprojectTomlIndex[];
      workspace?: {
        members: string[];
      };
      'build-backend'?: {
        'module-name'?: string[];
        namespace?: boolean;
      };
    };
  };
};

interface ILogger {
  setOptions(options: { silent: boolean }): void;
  info(message: unknown): void;
}

interface IUVProvider {
  install(): Promise<void>;
}

interface IUVProviderConstructor {
  new (workspaceRoot: string, logger: ILogger, tree?: Tree): IUVProvider;
}

interface ILoggerConstructor {
  new (): ILogger;
}

interface MigrateToSharedVenvSchema {
  moveDevDependencies: boolean;
  pyprojectPythonDependency: string;
  pyenvPythonVersion: string | number;
  autoActivate: boolean;
  packageManager: 'poetry' | 'uv';
}

interface UVProjectGeneratorSchema {
  name: string;
  publishable: boolean;
  buildLockedVersions: boolean;
  buildBundleLocalDependencies: boolean;
  linter: 'flake8' | 'ruff' | 'none';
  devDependenciesProject?: string;
  rootPyprojectDependencyGroup: string;
  templateDir?: string;
  pyprojectPythonDependency: string;
  projectType: 'application' | 'library';
  projectNameAndRootFormat: 'as-provided' | 'derived';
  packageName?: string;
  description?: string;
  moduleName?: string;
  pyenvPythonVersion?: string | number;
  tags?: string;
  directory?: string;
  useSyncGenerators?: boolean;
  unitTestRunner: 'pytest' | 'none';
  codeCoverage: boolean;
  codeCoverageHtmlReport: boolean;
  codeCoverageXmlReport: boolean;
  codeCoverageThreshold?: number;
  unitTestHtmlReport: boolean;
  unitTestJUnitReport: boolean;
  buildSystem: 'hatch' | 'uv';
  srcDir: boolean;
}

// ---------------------------------------------------------------------------
// Runtime module loading via filesystem paths
// ---------------------------------------------------------------------------

// Resolve the @nxlv/python package root by finding its package.json
// (which IS listed in the exports map as "./package.json")
const nxlvPythonPkgJson = require.resolve('@nxlv/python/package.json');
const nxlvPythonRoot = path.dirname(nxlvPythonPkgJson);

const uvProviderModule = require(
  path.join(nxlvPythonRoot, 'dist/provider/uv/provider'),
);

const loggerModule = require(
  path.join(nxlvPythonRoot, 'dist/executors/utils/logger'),
);

const migrateToSharedVenvModule = require(
  path.join(nxlvPythonRoot, 'dist/generators/migrate-to-shared-venv/generator'),
);

const uvProjectModule = require(
  path.join(nxlvPythonRoot, 'dist/generators/uv-project/generator'),
);

export const UVProvider: IUVProviderConstructor = uvProviderModule.UVProvider;

export const Logger: ILoggerConstructor = loggerModule.Logger;

export const migrateToSharedVenvGenerator: (
  tree: Tree,
  options: MigrateToSharedVenvSchema,
) => Promise<() => Promise<void>> =
  migrateToSharedVenvModule.default ?? migrateToSharedVenvModule;

export const uvProjectGenerator: (
  tree: Tree,
  options: UVProjectGeneratorSchema,
) => Promise<() => Promise<void>> = uvProjectModule.default ?? uvProjectModule;
