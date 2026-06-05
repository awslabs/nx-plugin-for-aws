/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CollectedDependency {
  name: string;
  version: string;
  rawLicense: string;
  ecosystem: string;
  path?: string;
}

export interface LicenseCollector {
  name: string;
  traceCommand?: string;
  collect(options: { workspaceRoot: string }): Promise<CollectedDependency[]>;
}

export const npmCollector = (): LicenseCollector => ({
  name: 'npm',
  get traceCommand() {
    const { existsSync } = require('fs');
    const { join } = require('path');
    const { workspaceRoot } = require('@nx/devkit');
    if (existsSync(join(workspaceRoot, 'yarn.lock')))
      return 'yarn why <package>';
    if (existsSync(join(workspaceRoot, 'bun.lockb')))
      return 'bun pm why <package>';
    if (existsSync(join(workspaceRoot, 'package-lock.json')))
      return 'npm why <package>';
    return 'pnpm why <package>';
  },
  async collect({ workspaceRoot }) {
    const { collectNpmDependencies } = await import('./npm-collector');
    return (await collectNpmDependencies({ start: workspaceRoot })).map(
      (d) => ({ ...d, ecosystem: 'npm' }),
    );
  },
});

export const pythonCollector = (): LicenseCollector => ({
  name: 'python',
  traceCommand: 'uv tree --invert --package <package>',
  async collect({ workspaceRoot }) {
    const { collectPythonDependencies } = await import('./python-collector');
    const { findWorkspacePyProjectNames } = await import('./python-collector');
    const excludePackages = await findWorkspacePyProjectNames(workspaceRoot);
    return (
      await collectPythonDependencies({ start: workspaceRoot, excludePackages })
    ).map((d) => ({ ...d, ecosystem: 'pypi' }));
  },
});

export const DEFAULT_COLLECTORS: LicenseCollector[] = [
  npmCollector(),
  pythonCollector(),
];
