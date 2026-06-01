/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { SPDXLicenseIdentifier } from './schema';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils';
import { CommentSyntax, LicenseConfig } from './config-types';
import { DependencyCheckException } from './dependency-check/types';

/**
 * Licenses containing a placeholder for the copyright year.
 */
const LICENSES_WITH_YEAR: Set<SPDXLicenseIdentifier> = new Set(['MIT']);

/**
 * Defines the comment syntax for popular programming languages
 */
export const LANGUAGE_COMMENT_SYNTAX: { [ext: string]: CommentSyntax } = {
  // C++ style comments
  ...Object.fromEntries(
    [
      // Node
      'js',
      'ts',
      'cjs',
      'mjs',
      'cts',
      'mts',
      // React
      'jsx',
      'tsx',
      // Web
      'sass',
      'scss',
      'php',
      // Java
      'java',
      // TypeSpec
      'tsp',
      // Golang
      'go',
      // Rust
      'rs',
      // C and C++
      'c',
      'cpp',
      'cxx',
      'cc',
      'h',
      'hpp',
      // C#
      'cs',
      // Scala
      'scala',
      'sc',
      'sbt',
      // Kotlin
      'kt',
      // Swift
      'swift',
    ].map((ext) => [ext, { line: '//', block: { start: '/*', end: '*/' } }]),
  ),
  // Bash style comments
  ...Object.fromEntries(
    [
      // Bash
      'sh',
      // Perl
      'pl',
      // YAML
      'yaml',
      'yml',
      // R
      'r',
    ].map((ext) => [ext, { line: '#' }]),
  ),
  // Docker
  Dockerfile: { line: '#' },
  // Python
  py: { line: '#', block: { start: '"""', end: '"""' } },
  // Web
  html: { block: { start: '<!--', end: '-->' } },
  css: { block: { start: '/*', end: '*/' } },
  // Ruby
  rb: { line: '#', block: { start: '=begin', end: '=end' } },
  // F#
  ...Object.fromEntries(
    ['fs', 'fsx'].map((ext) => [
      ext,
      { line: '//', block: { start: '(*', end: '*)' } },
    ]),
  ),
  // Visual Basic
  vb: { line: "' " },
  // Lua
  lua: { line: '--', block: { start: '--[[', end: ']]' } },
  // PowerShell
  ps1: { line: '#', block: { start: '<#', end: '#>' } },
  psm1: { line: '#', block: { start: '<#', end: '#>' } },
  // Markdown
  md: { block: { start: '<!--', end: '-->' } },
  // Terraform
  tf: { line: '#', block: { start: '/*', end: '*/' } },
  // Smithy
  smithy: { line: '//' },
};

export const defaultDependencyCheckConfig = (): NonNullable<
  Exclude<LicenseConfig['dependencyCheck'], false>
> => ({
  allow: [],
  collectors: [],
  exceptions: [],
});

/**
 * Build the default license config for a given license
 */
export const defaultLicenseConfig = (
  spdx: SPDXLicenseIdentifier,
  copyrightHolder: string,
  options?: { dependencyCheck?: boolean },
): LicenseConfig => {
  const dependencyCheck =
    options?.dependencyCheck === false ? false : defaultDependencyCheckConfig();
  switch (spdx) {
    case 'ASL': {
      // For ASL, we use a "box" style license header
      const rawContent = [
        `Copyright ${copyrightHolder}. All Rights Reserved.`,
        '',
        'Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance',
        'with the License. A copy of the License is located at',
        '',
        '   https://aws.amazon.com/asl/',
        '',
        'or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES',
        'OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions',
        'and limitations under the License.',
      ];
      const maxLen = Math.max(...rawContent.map((line) => line.length));
      const lines = rawContent.map(
        (line) => `${line}${' '.repeat(maxLen - line.length)}`,
      );
      return {
        spdx,
        copyrightHolder,
        header: {
          content: { lines },
          format: {
            '**/*.{js,ts,jsx,tsx,mjs,mts}': {
              blockStart: `/***${'*'.repeat(maxLen)}**`,
              lineStart: ' *  ',
              lineEnd: ' *',
              blockEnd: ` ***${'*'.repeat(maxLen)}**/`,
            },
            '**/*.{py,sh,tf}': {
              blockStart: `###${'#'.repeat(maxLen)}##`,
              lineStart: '#  ',
              lineEnd: ' #',
              blockEnd: `###${'#'.repeat(maxLen)}##`,
            },
          },
          exclude: ['**/*.gen.*'],
        },
        ...(dependencyCheck === false ? {} : { dependencyCheck }),
      };
    }
    default: {
      return {
        spdx,
        copyrightHolder,
        ...(LICENSES_WITH_YEAR.has(spdx)
          ? {
              copyrightYear: new Date().getFullYear(),
            }
          : {}),
        header: {
          content: {
            lines: [
              `Copyright ${copyrightHolder}. All Rights Reserved.`,
              `SPDX-License-Identifier: ${spdx}`,
            ],
          },
          format: {
            '**/*.{js,ts,jsx,tsx,mjs,mts}': {
              blockStart: '/**',
              lineStart: ' * ',
              blockEnd: ' */',
            },
            '**/*.{py,sh,tf}': {
              blockStart: '#',
              lineStart: '# ',
              blockEnd: '#',
            },
          },
          exclude: ['**/*.gen.*'],
        },
        ...(dependencyCheck === false ? {} : { dependencyCheck }),
      };
    }
  }
};

/**
 * Write license configuration to the aws nx plugin config
 */
export const writeLicenseConfig = async (tree: Tree, config: LicenseConfig) => {
  await updateAwsNxPluginConfig(tree, {
    license: config,
  });
};

/**
 * Read license configuration
 */
export const readLicenseConfig = async (
  tree: Tree,
): Promise<LicenseConfig | undefined> => {
  return (await readAwsNxPluginConfig(tree))?.license;
};

/**
 * Add license exceptions to the workspace config. No-op if license checking
 * is not configured. Deduplicates by package name.
 */
export const addLicenseExceptions = async (
  tree: Tree,
  exceptions: DependencyCheckException[],
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const configSource = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
  if (!configSource.includes('dependencyCheck')) return;

  const config = await readLicenseConfig(tree);
  if (!config || config.dependencyCheck === false || !config.dependencyCheck) {
    return;
  }

  const existing = config.dependencyCheck.exceptions ?? [];
  const existingPackages = new Set(existing.map((e) => e.package));
  const newExceptions = exceptions.filter(
    (e) => !existingPackages.has(e.package),
  );

  if (newExceptions.length === 0) return;

  config.dependencyCheck.exceptions = [...existing, ...newExceptions];
  await writeLicenseConfig(tree, config);
  await restoreDependencyCheckImports(tree);
};

/**
 * Re-apply import references in the config after a write (which serializes
 * expressions as their JSON values).
 */
export const restoreDependencyCheckImports = async (
  tree: Tree,
  options?: { includeCollectors?: 'npm' | 'npm+python' },
): Promise<void> => {
  const { addDestructuredImport, applyGritQL } = await import('../utils/ast');
  const imports = ['DEFAULT_LICENSE_ALLOWLIST', 'npmCollector'];
  if (options?.includeCollectors === 'npm+python') {
    imports.push('pythonCollector');
  }
  await addDestructuredImport(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    imports,
    '@aws/nx-plugin/license',
  );
  await applyGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    '`allow: $val` => `allow: DEFAULT_LICENSE_ALLOWLIST` where { $val <: within `dependencyCheck: $_` }',
  );
  const collectorsExpr =
    options?.includeCollectors === 'npm+python'
      ? 'collectors: [npmCollector(), pythonCollector()]'
      : 'collectors: [npmCollector()]';
  await applyGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    `\`collectors: $val\` => \`${collectorsExpr}\` where { $val <: within \`dependencyCheck: $_\` }`,
  );
};

/**
 * Add pythonCollector() to the dependency check config if it isn't already
 * present. Called by py#project when a Python project is generated.
 */
export const addPythonCollectorToConfig = async (tree: Tree): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;
  const source = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
  if (!source.includes('dependencyCheck')) return;
  if (source.includes('pythonCollector')) return;

  const { addDestructuredImport, applyGritQL } = await import('../utils/ast');
  await addDestructuredImport(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    ['pythonCollector'],
    '@aws/nx-plugin/license',
  );
  await applyGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    '`collectors: [$items]` => `collectors: [$items, pythonCollector()]` where { $items <: within `dependencyCheck: $_` }',
  );
};
