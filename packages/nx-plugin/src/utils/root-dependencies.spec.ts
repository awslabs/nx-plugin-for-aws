/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { globAsync } from '@nx/devkit';
import { FsTree } from 'nx/src/generators/tree';
import { join } from 'path';

const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..');

interface PackageJson {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('root dependencies', () => {
  it('should declare every published package dependency in the root package.json', async () => {
    const tree = new FsTree(WORKSPACE_ROOT, false);

    const readPackageJson = (path: string): PackageJson =>
      JSON.parse(tree.read(path, 'utf-8') ?? '{}');

    const rootPackageJson = readPackageJson('package.json');
    const rootDependencies = {
      ...rootPackageJson.devDependencies,
      ...rootPackageJson.dependencies,
    };

    const packageJsonPaths = (
      await globAsync(tree, ['packages/*/package.json'])
    ).sort();
    expect(packageJsonPaths.length).toBeGreaterThan(0);

    const errors: string[] = [];
    for (const path of packageJsonPaths) {
      const packageJson = readPackageJson(path);
      if (packageJson.private) continue;

      for (const [name, version] of Object.entries(
        packageJson.dependencies ?? {},
      )) {
        const rootVersion = rootDependencies[name];
        if (!rootVersion) {
          errors.push(
            `${packageJson.name}: "${name}": "${version}" is missing from the root package.json devDependencies`,
          );
        } else if (rootVersion !== version) {
          errors.push(
            `${packageJson.name}: "${name}" is "${version}" but the root package.json declares "${rootVersion}"`,
          );
        }
      }
    }

    expect(
      errors,
      `A \`pnpm link dist/packages/<pkg>\` workspace resolves the linked package's imports from the root node_modules, so every published package dependency must also be declared in the root package.json at the same version.\nAdd each dependency below to the root package.json devDependencies and run \`pnpm install\`.\n${errors.join('\n')}`,
    ).toEqual([]);
  });
});
