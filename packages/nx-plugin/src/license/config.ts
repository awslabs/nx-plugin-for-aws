/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { SPDXLicenseIdentifier } from './schema';
import {
  readAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils';
import { CommentSyntax, LicenseConfig } from './config-types';

/**
 * Licenses containing a placeholder for the copyright year
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
      // Smithy
      'smithy',
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
};

/**
 * Build the default license config for a given license
 */
export const defaultLicenseConfig = (
  spdx: SPDXLicenseIdentifier,
  copyrightHolder: string,
): LicenseConfig => {
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
            '**/*.{py,sh}': {
              blockStart: `###${'#'.repeat(maxLen)}##`,
              lineStart: '#  ',
              lineEnd: ' #',
              blockEnd: `###${'#'.repeat(maxLen)}##`,
            },
          },
          exclude: [],
        },
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
            '**/*.{py,sh}': {
              blockStart: '# ',
              lineStart: '# ',
              blockEnd: '# ',
            },
          },
          exclude: [],
        },
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
