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

/**
 * Module specifier for the license helpers exported by this package, used by
 * imports written into the user's config file.
 */
const LICENSE_SDK_MODULE = '@aws/nx-plugin/sdk/license';

/**
 * Produce a valid TypeScript string literal for an arbitrary value.
 * `JSON.stringify` yields a double-quoted literal with all escaping handled
 * (quotes, backslashes, newlines, and other control characters), so the result
 * is always parseable — prettier later normalises the quote style.
 */
const toStringLiteral = (value: string): string => JSON.stringify(value);

/**
 * Escape a string for embedding in a double-quoted GritQL string pattern.
 * Control characters are stripped to single spaces because a literal newline
 * inside a GritQL backtick string breaks pattern parsing; the value is only
 * used for an equality check against existing source, where package names
 * never contain control characters.
 */
const toGritStringLiteral = (value: string): string =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, ' ')}"`;

/**
 * Build the object literal source for a dependency check exception.
 */
const exceptionLiteral = (exception: DependencyCheckException): string => {
  const parts = [`package: ${toStringLiteral(exception.package)}`];
  if (exception.version !== undefined) {
    parts.push(`version: ${toStringLiteral(exception.version)}`);
  }
  parts.push(`reason: ${toStringLiteral(exception.reason)}`);
  if (exception.spdx !== undefined) {
    parts.push(`spdx: ${toStringLiteral(exception.spdx)}`);
  }
  return `{ ${parts.join(', ')} }`;
};

/**
 * GritQL pattern binding the body of the `license` object to `$scope`.
 *
 * Array edits are scoped to the license object (rather than to a bare
 * `dependencyCheck: { ... }`) so a `dependencyCheck`-shaped object declared
 * elsewhere in the file is never matched. The `collectors`/`exceptions` arrays
 * only exist inside `license.dependencyCheck`, so searching within the license
 * body targets them unambiguously.
 */
const DEPENDENCY_CHECK_SCOPE = '`license: { $scope }`';

export interface EnsureDependencyCheckBlockOptions {
  includeCollectors?: 'npm' | 'npm+python';
}

/**
 * Ensure the `dependencyCheck` block exists within the `license` config.
 * Idempotent: if a `dependencyCheck` property already exists it is left
 * untouched, so user customizations are never overwritten.
 */
export const ensureDependencyCheckBlock = async (
  tree: Tree,
  options?: EnsureDependencyCheckBlockOptions,
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { addDestructuredImport, applyGritQL, matchGritQL } =
    await import('../utils/ast');

  // No-op if the dependency check is already configured
  if (
    await matchGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      '`dependencyCheck: $_`',
    )
  ) {
    return;
  }

  const imports = ['DEFAULT_LICENSE_ALLOWLIST', 'npmCollector'];
  if (options?.includeCollectors === 'npm+python') {
    imports.push('pythonCollector');
  }
  await addDestructuredImport(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    imports,
    LICENSE_SDK_MODULE,
  );

  const collectorsExpr =
    options?.includeCollectors === 'npm+python'
      ? 'collectors: [npmCollector(), pythonCollector()]'
      : 'collectors: [npmCollector()]';

  const depCheckBlock = `dependencyCheck: { allow: DEFAULT_LICENSE_ALLOWLIST, ${collectorsExpr}, exceptions: [] }`;

  // Append the block to the license object. GritQL's += inserts the property
  // into the property list, so it's comma-aware and never adds a stray comma.
  await applyGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    `\`license: { $props }\` where { $props <: not contains \`dependencyCheck: $_\`, $props += \`${depCheckBlock}\` }`,
  );

  await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
};

/**
 * Ensure license exceptions are present in the config.
 * Idempotent: an exception whose package is already listed is skipped.
 * Existing exceptions, collectors, and the allowlist are preserved. Appending
 * is performed with GritQL's list-aware append, so it never introduces array
 * holes regardless of the array's existing shape or trailing commas.
 */
export const ensureLicenseExceptions = async (
  tree: Tree,
  exceptions: DependencyCheckException[],
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { appendToArrayInScope, matchGritQL } = await import('../utils/ast');

  if (
    !(await matchGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      '`dependencyCheck: $_`',
    ))
  ) {
    return;
  }

  const modified = await appendToArrayInScope(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    {
      scopePattern: DEPENDENCY_CHECK_SCOPE,
      arrayKey: 'exceptions',
      elements: exceptions.map(exceptionLiteral),
      // Skip if a matching package exception is already present, so existing
      // exceptions (and their reasons) are never overwritten.
      guard: (i) =>
        `$scope <: not contains \`package: ${toGritStringLiteral(exceptions[i].package)}\``,
      elementNodePattern: '`{ $_ }`',
    },
  );

  if (modified) {
    await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
  }
};

/**
 * Add pythonCollector() to the dependency check config if not already present.
 * Idempotent: skipped if pythonCollector is already a collector. Appending uses
 * GritQL's list-aware append, so it never introduces array holes.
 */
export const ensurePythonLicenseCollector = async (
  tree: Tree,
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { addDestructuredImport, appendToArrayInScope, matchGritQL } =
    await import('../utils/ast');

  if (
    !(await matchGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      '`dependencyCheck: $_`',
    ))
  ) {
    return;
  }

  const added = await appendToArrayInScope(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    {
      scopePattern: DEPENDENCY_CHECK_SCOPE,
      arrayKey: 'collectors',
      elements: ['pythonCollector()'],
      guard: () => '$scope <: not contains `pythonCollector`',
      elementNodePattern: '`$_()`',
    },
  );

  if (added) {
    await addDestructuredImport(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      ['pythonCollector'],
      LICENSE_SDK_MODULE,
    );
    await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
  }
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
 * Write license configuration to the aws nx plugin config.
 *
 * The license header/files settings are (re)written, but any existing
 * `dependencyCheck` block — including a user-customized allowlist, collectors,
 * and exceptions — is preserved verbatim. This keeps re-running the license
 * generator (e.g. to change the copyright holder) from clobbering dependency
 * check customizations.
 *
 * The dependencyCheck block is captured from source and re-attached entirely
 * via GritQL, so JS expressions in it (imported constants, `npmCollector()`)
 * survive untouched.
 */
export const writeLicenseConfig = async (tree: Tree, config: LicenseConfig) => {
  const { applyGritQL, captureGritQL } = await import('../utils/ast');

  // The dependencyCheck block is managed by the ensure* helpers and is never
  // written from the passed config; it is preserved from source instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { dependencyCheck, ...configWithoutDependencyCheck } = config;

  // Capture the existing `dependencyCheck: { ... }` property text (if any)
  // before we overwrite the license value, so we can re-attach it afterwards.
  let preservedDependencyCheck: string | undefined;
  if (tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) {
    preservedDependencyCheck = await captureGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      '`dependencyCheck: $_`',
    );
  }

  await updateAwsNxPluginConfig(tree, {
    license: configWithoutDependencyCheck,
  });

  // Re-attach the preserved dependencyCheck block into the freshly-written
  // license object (only if it isn't already present). A placeholder property
  // is appended via GritQL's list-aware `+=`, then substituted with the
  // captured text — so the preserved block's own content (which may contain
  // backticks, `${...}`, quotes) never enters the GritQL pattern.
  if (preservedDependencyCheck) {
    const placeholder = '__GRIT_DEPENDENCY_CHECK_PLACEHOLDER__';
    const appended = await applyGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `\`license: { $props }\` where { $props <: not contains \`dependencyCheck: $_\`, $props += \`${placeholder}: true\` }`,
    );
    if (appended) {
      const content = tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;
      // Function replacer avoids `$` in the captured text being treated as a
      // special replacement pattern.
      tree.write(
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        content.replace(`${placeholder}: true`, () => preservedDependencyCheck),
      );
      await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
    }
  }
};

/**
 * Read license configuration
 */
export const readLicenseConfig = async (
  tree: Tree,
): Promise<LicenseConfig | undefined> => {
  return (await readAwsNxPluginConfig(tree))?.license;
};
