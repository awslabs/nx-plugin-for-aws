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
 * Build the object literal source for a dependency check exception.
 * `JSON.stringify` produces valid string literals for arbitrary text (quotes,
 * backslashes, newlines all escaped); prettier later normalises quote style.
 */
const exceptionLiteral = (exception: DependencyCheckException): string => {
  const parts = [`package: ${JSON.stringify(exception.package)}`];
  if (exception.version !== undefined) {
    parts.push(`version: ${JSON.stringify(exception.version)}`);
  }
  parts.push(`reason: ${JSON.stringify(exception.reason)}`);
  if (exception.spdx !== undefined) {
    parts.push(`spdx: ${JSON.stringify(exception.spdx)}`);
  }
  return `{ ${parts.join(', ')} }`;
};

/**
 * GritQL `or` block that appends `$ins` (the insert placeholder) to the named
 * array inside the matched `$scope`, handling all three array shapes without
 * ever producing an array hole:
 *   - `key: []`      → `key: [$ins]`
 *   - `key: [x]`     → `key: [x, $ins]`   (single element matching `node`)
 *   - `key: [a, b,]` → list-append, which is comma-aware (no trailing-comma hole)
 *
 * `node` is the GritQL pattern a lone element matches (e.g. `` `{ $_ }` `` for
 * an object, `` `$_()` `` for a call), used so the single-element branch can't
 * greedily match a multi-element array.
 */
const appendToArray = (key: string, node: string, ins: string) =>
  `or {
    $scope <: contains \`${key}: []\` => \`${key}: [${ins}]\`,
    $scope <: contains \`${key}: [$only]\` where { $only <: ${node} } => \`${key}: [$only, ${ins}]\`,
    $scope <: contains \`${key}: [$items]\` where { $items += \`${ins}\` }
  }`;

export interface EnsureDependencyCheckBlockOptions {
  includeCollectors?: 'npm' | 'npm+python';
}

/**
 * Ensure the `dependencyCheck` block exists within the `license` config.
 * If one already exists it is left untouched, so user customizations survive.
 */
export const ensureDependencyCheckBlock = async (
  tree: Tree,
  options?: EnsureDependencyCheckBlockOptions,
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { addDestructuredImport, applyGritQL, matchGritQL } =
    await import('../utils/ast');

  if (
    await matchGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      '`dependencyCheck: $_`',
    )
  ) {
    return;
  }

  const withPython = options?.includeCollectors === 'npm+python';
  const collectors = withPython
    ? 'collectors: [npmCollector(), pythonCollector()]'
    : 'collectors: [npmCollector()]';

  // `+=` adds the property to the license object's property list, so it's
  // comma-aware and never leaves a stray comma.
  const added = await applyGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    `\`license: { $props }\` where {
      $props <: not contains \`dependencyCheck: $_\`,
      $props += \`dependencyCheck: { allow: DEFAULT_LICENSE_ALLOWLIST, ${collectors}, exceptions: [] }\`
    }`,
  );

  // Only add the imports if the block was actually written (i.e. a license
  // object literal existed to attach it to).
  if (added) {
    await addDestructuredImport(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      withPython
        ? ['DEFAULT_LICENSE_ALLOWLIST', 'npmCollector', 'pythonCollector']
        : ['DEFAULT_LICENSE_ALLOWLIST', 'npmCollector'],
      LICENSE_SDK_MODULE,
    );
    await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
  }
};

/**
 * Ensure license exceptions are present in `license.dependencyCheck.exceptions`.
 * An exception whose package is already listed is skipped (so existing reasons
 * are never overwritten). Other exceptions, collectors and the allowlist are
 * left untouched.
 *
 * The `license: { $scope }` scope avoids matching a `dependencyCheck`-shaped
 * object declared elsewhere in the file.
 */
export const ensureLicenseExceptions = async (
  tree: Tree,
  exceptions: DependencyCheckException[],
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { insertViaGritQL, matchGritQL, GRIT_INSERT_PLACEHOLDER } =
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

  let modified = false;
  for (const exception of exceptions) {
    const pkg = JSON.stringify(exception.package);
    const inserted = await insertViaGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `\`license: { $scope }\` where {
        $scope <: not contains \`package: ${pkg}\`,
        ${appendToArray('exceptions', '`{ $_ }`', GRIT_INSERT_PLACEHOLDER)}
      }`,
      exceptionLiteral(exception),
    );
    modified ||= inserted;
  }

  if (modified) {
    await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
  }
};

/**
 * Add `pythonCollector()` to `license.dependencyCheck.collectors`, unless one
 * is already configured.
 */
export const ensurePythonLicenseCollector = async (
  tree: Tree,
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const {
    addDestructuredImport,
    insertViaGritQL,
    matchGritQL,
    GRIT_INSERT_PLACEHOLDER,
  } = await import('../utils/ast');

  if (
    !(await matchGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      '`dependencyCheck: $_`',
    ))
  ) {
    return;
  }

  const added = await insertViaGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    `\`license: { $scope }\` where {
      $scope <: not contains \`pythonCollector\`,
      ${appendToArray('collectors', '`$_()`', GRIT_INSERT_PLACEHOLDER)}
    }`,
    'pythonCollector()',
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
 * `dependencyCheck` block — including a user-customized allowlist, collectors
 * and exceptions — is preserved, so re-running the license generator (e.g. to
 * change the copyright holder) never clobbers dependency-check customizations.
 */
export const writeLicenseConfig = async (tree: Tree, config: LicenseConfig) => {
  const { insertViaGritQL, captureGritQL, GRIT_INSERT_PLACEHOLDER } =
    await import('../utils/ast');

  // The dependencyCheck block is managed by the ensure* helpers, never written
  // from the passed config; it is preserved from source instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { dependencyCheck, ...licenseHeaderConfig } = config;

  // Capture the existing `dependencyCheck: { ... }` text before overwriting the
  // license value, so we can re-attach it afterwards.
  const preserved = tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)
    ? await captureGritQL(
        tree,
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        '`dependencyCheck: $_`',
      )
    : undefined;

  await updateAwsNxPluginConfig(tree, { license: licenseHeaderConfig });

  // Re-attach the preserved block via a placeholder so its content (which may
  // contain backticks, `${...}` or quotes) never enters the GritQL pattern.
  if (preserved) {
    await insertViaGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `\`license: { $props }\` where {
        $props <: not contains \`dependencyCheck: $_\`,
        $props += \`${GRIT_INSERT_PLACEHOLDER}\`
      }`,
      preserved,
    );
    await formatFilesInSubtree(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
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
