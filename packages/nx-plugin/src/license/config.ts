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
import { formatFilesInSubtree } from '../utils/format';

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

export interface EnsureDependencyCheckBlockOptions {
  includeCollectors?: 'npm' | 'npm+python';
}

/**
 * Ensure the `dependencyCheck` block exists in the config file.
 * Idempotent: if the block already exists, this is a no-op.
 */
export const ensureDependencyCheckBlock = async (
  tree: Tree,
  options?: EnsureDependencyCheckBlockOptions,
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const source = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
  if (source.includes('dependencyCheck')) return;

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

  const collectorsExpr =
    options?.includeCollectors === 'npm+python'
      ? 'collectors: [npmCollector(), pythonCollector()]'
      : 'collectors: [npmCollector()]';

  const depCheckBlock = `dependencyCheck: { allow: DEFAULT_LICENSE_ALLOWLIST, ${collectorsExpr}, exceptions: [] }`;

  // Append dependencyCheck to the license object by finding the last property
  // and inserting after it. We use a direct source manipulation approach
  // since GritQL's += on nested objects can produce double commas.
  const currentSource = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;

  // Find the license object's closing brace by locating `license:` and
  // then finding the matching closing brace.
  const licenseIdx = currentSource.indexOf('license:');
  if (licenseIdx === -1) return;

  // Find the opening brace of the license object
  const openBrace = currentSource.indexOf('{', licenseIdx);
  if (openBrace === -1) return;

  // Find the matching closing brace
  let depth = 0;
  let closeBrace = -1;
  for (let i = openBrace; i < currentSource.length; i++) {
    if (currentSource[i] === '{') depth++;
    if (currentSource[i] === '}') {
      depth--;
      if (depth === 0) {
        closeBrace = i;
        break;
      }
    }
  }

  if (closeBrace === -1) return;

  // Insert the dependencyCheck block before the closing brace
  const before = currentSource.slice(0, closeBrace);
  const after = currentSource.slice(closeBrace);
  const needsComma = before.trimEnd().endsWith(',') ? '' : ',';
  const updated = `${before}${needsComma}\n    ${depCheckBlock},\n  ${after}`;
  tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, updated);

  await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
};

/**
 * Ensure license exceptions are present in the config.
 * Idempotent: skips exceptions whose package is already listed.
 */
export const ensureLicenseExceptions = async (
  tree: Tree,
  exceptions: DependencyCheckException[],
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const source = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
  if (!source.includes('dependencyCheck')) return;

  const { applyGritQL } = await import('../utils/ast');

  let modified = false;
  for (const exception of exceptions) {
    const currentSource = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
    if (currentSource.includes(exception.package)) continue;

    const exceptionLiteral = `{ package: '${exception.package}', reason: '${exception.reason.replace(/'/g, "\\'")}', spdx: '${exception.spdx}' }`;

    // Try appending to non-empty exceptions array
    let appended = await applyGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `\`exceptions: [$items]\` => \`exceptions: [$items, ${exceptionLiteral}]\` where { $items <: within \`dependencyCheck: $_\`, $items <: not \`\` }`,
    );

    if (!appended) {
      // Handle empty array: exceptions: []
      appended = await applyGritQL(
        tree,
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        `\`exceptions: []\` => \`exceptions: [${exceptionLiteral}]\` where { $_ <: within \`dependencyCheck: $_\` }`,
      );
    }

    if (appended) modified = true;
  }

  if (modified) {
    await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
  }
};

/**
 * Add pythonCollector() to the dependency check config if not already present.
 */
export const ensurePythonLicenseCollector = async (
  tree: Tree,
): Promise<void> => {
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
            '**/*.{py,sh,tf}': {
              blockStart: `###${'#'.repeat(maxLen)}##`,
              lineStart: '#  ',
              lineEnd: ' #',
              blockEnd: `###${'#'.repeat(maxLen)}##`,
            },
          },
          exclude: ['**/*.gen.*'],
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
            '**/*.{py,sh,tf}': {
              blockStart: '#',
              lineStart: '# ',
              blockEnd: '#',
            },
          },
          exclude: ['**/*.gen.*'],
        },
      };
    }
  }
};

/**
 * Write license configuration to the aws nx plugin config
 */
export const writeLicenseConfig = async (tree: Tree, config: LicenseConfig) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { dependencyCheck, ...configWithoutDependencyCheck } = config;
  await updateAwsNxPluginConfig(tree, {
    license: configWithoutDependencyCheck,
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
