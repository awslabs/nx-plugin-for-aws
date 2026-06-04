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
import {
  CommentSyntax,
  LicenseConfig,
  LicenseSourceConfig,
} from './config-types';
import { DependencyCheckException } from './dependency-check/types';
import { addDependencyToTargetIfNotPresent } from '../utils/nx';
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
 * an object, `` `$_($_)` `` for a call with or without an argument), used so
 * the single-element branch can't greedily match a multi-element array.
 */
const appendToArray = (key: string, node: string, ins: string) =>
  `or {
    $scope <: contains \`${key}: []\` => \`${key}: [${ins}]\`,
    $scope <: contains \`${key}: [$only]\` where { $only <: ${node} } => \`${key}: [$only, ${ins}]\`,
    $scope <: contains \`${key}: [$items]\` where { $items += \`${ins}\` }
  }`;

/**
 * Insert `property` (TypeScript source like `dependencies: { ... }`) as the
 * first property of the `license` object literal.
 *
 * Prepending is comma-safe for every shape — empty `{}`, single- or multi-line.
 * `+=` appending is not: it omits the separator when the last property's value
 * is an object/array literal (e.g. `source: { ... }`), corrupting the file. The
 * property text is routed through a placeholder so its content never enters the
 * GritQL pattern. Returns true if the file changed (a `license` object existed).
 */
const prependLicenseProperty = async (
  tree: Tree,
  property: string,
): Promise<boolean> => {
  const { insertViaGritQL, GRIT_INSERT_PLACEHOLDER } =
    await import('../utils/ast');

  // Non-empty license object: insert before the first existing property.
  const intoNonEmpty = await insertViaGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    `\`license: { $props }\` where { $props => \`${GRIT_INSERT_PLACEHOLDER}, $props\` }`,
    property,
  );
  if (intoNonEmpty) return true;

  // Empty license object: `{ $props }` doesn't match `{}`, so fill it directly.
  return insertViaGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    `\`license: {}\` => \`license: { ${GRIT_INSERT_PLACEHOLDER} }\``,
    property,
  );
};

/**
 * Whether `license.dependencies` (the dependency-check block) is configured.
 * Scoped within `license` so a `dependencies`-shaped object elsewhere in the
 * file isn't mistaken for it.
 */
const hasDependenciesBlock = async (tree: Tree): Promise<boolean> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return false;
  const { matchGritQL } = await import('../utils/ast');
  return matchGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    '`license: { $l }` where { $l <: contains `dependencies: $_` }',
  );
};

/**
 * Workspace-root npm-ecosystem lockfiles. Each is added to the license-check
 * cache inputs only when present, so the cache invalidates on dependency
 * changes without listing lockfiles for package managers the workspace doesn't
 * use.
 */
const NPM_LOCKFILES = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
];

/**
 * Recompute the `inputs` of the root `license-check` target from what's
 * currently in the workspace: the present npm lockfiles, the config file, and
 * a recursive uv.lock glob when the dependency check uses a Python collector.
 *
 * The uv lockfile is keyed off the collector (not file presence) because it is
 * created by `uv` *after* the generator runs, and may live in a subdirectory of
 * a uv workspace. Callers run this whenever they change the relevant state, so
 * the inputs stay correct regardless of generator order. No-op if the
 * license-check target doesn't exist yet.
 */
export const updateLicenseCheckTargetInputs = async (
  tree: Tree,
): Promise<void> => {
  const rootProjectJsonPath = 'project.json';
  if (!tree.exists(rootProjectJsonPath)) return;

  const rootProject = JSON.parse(tree.read(rootProjectJsonPath, 'utf-8')!);
  const target = rootProject.targets?.['license-check'];
  if (!target) return;

  const inputs = NPM_LOCKFILES.filter((f) => tree.exists(f)).map(
    (f) => `{workspaceRoot}/${f}`,
  );

  if (await hasPythonCollector(tree)) {
    inputs.push('{workspaceRoot}/**/uv.lock');
  }

  inputs.push('{workspaceRoot}/aws-nx-plugin.config.mts');

  target.inputs = inputs;
  tree.write(rootProjectJsonPath, JSON.stringify(rootProject, null, 2));
};

/**
 * Whether the dependency check config has a `pythonCollector` configured.
 */
const hasPythonCollector = async (tree: Tree): Promise<boolean> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return false;
  const { matchGritQL } = await import('../utils/ast');
  return matchGritQL(tree, AWS_NX_PLUGIN_CONFIG_FILE_NAME, '`pythonCollector`');
};

/**
 * The name of the project that owns the root `license-check` target, or
 * undefined if no project defines it.
 */
const findLicenseCheckProjectName = (tree: Tree): string | undefined => {
  const { getProjects } = require('@nx/devkit');
  for (const [name, config] of getProjects(tree)) {
    if (config.targets?.['license-check']) return name;
  }
  return undefined;
};

/**
 * Make a project's `lint` target depend on the root `license-check` target, so
 * license checking runs as part of lint/build. No-op when the project has no
 * `lint` target or there's no license-check target to depend on. Idempotent.
 *
 * The updated project.json is formatted, since `updateProjectConfiguration`
 * writes expanded JSON that would otherwise fail a project's own JSON lint.
 */
export const addLicenseCheckToLintTarget = async (
  tree: Tree,
  projectName: string,
): Promise<void> => {
  const {
    readProjectConfiguration,
    updateProjectConfiguration,
  } = require('@nx/devkit');

  const licenseCheckProject = findLicenseCheckProjectName(tree);
  if (!licenseCheckProject) return;

  let project;
  try {
    project = readProjectConfiguration(tree, projectName);
  } catch {
    return;
  }

  // Only wire projects that actually lint, and never the license-check project
  // itself (a target can't depend on its own project's target).
  if (!project.targets?.lint || projectName === licenseCheckProject) return;

  addDependencyToTargetIfNotPresent(project, 'lint', {
    projects: [licenseCheckProject],
    target: 'license-check',
  });
  updateProjectConfiguration(tree, projectName, project);
  await formatFilesInSubtree(tree, `${project.root}/project.json`);
};

/**
 * Wire every project's `lint` target to the root `license-check` target.
 * Called by the license generator so existing projects pick up the dependency
 * regardless of the order generators ran in.
 */
export const addLicenseCheckToAllLintTargets = async (
  tree: Tree,
): Promise<void> => {
  const { getProjects } = require('@nx/devkit');
  for (const [name] of getProjects(tree)) {
    await addLicenseCheckToLintTarget(tree, name);
  }
};

export interface EnsureDependencyCheckBlockOptions {
  includeCollectors?: 'npm' | 'npm+python';
}

/**
 * Ensure the `dependencies` block (dependency license checking) exists within
 * the `license` config. If one already exists it is left untouched, so user
 * customizations survive.
 */
export const ensureDependencyCheckBlock = async (
  tree: Tree,
  options?: EnsureDependencyCheckBlockOptions,
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { addDestructuredImport } = await import('../utils/ast');

  if (await hasDependenciesBlock(tree)) {
    return;
  }

  const withPython = options?.includeCollectors === 'npm+python';
  const collectors = withPython
    ? 'collectors: [npmCollector(), pythonCollector()]'
    : 'collectors: [npmCollector()]';

  const block = `dependencies: { allow: DEFAULT_LICENSE_ALLOWLIST, ${collectors}, exceptions: [] }`;

  // Prepend the block as the first property of the license object. Prepending
  // (rather than `+=` appending) is comma-safe for every shape: GritQL's `+=`
  // omits the separator when the last existing property's value is an object
  // literal (e.g. `source: { ... }`), which would corrupt the file.
  const added = await prependLicenseProperty(tree, block);

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
 * Ensure license exceptions are present in `license.dependencies.exceptions`.
 * An exception whose package is already listed is skipped (so existing reasons
 * are never overwritten). Other exceptions, collectors and the allowlist are
 * left untouched.
 *
 * The `dependencies: { $scope }` scope keeps edits within the dependency-check
 * block, so an `exceptions` array elsewhere in the file isn't matched.
 */
export const ensureLicenseExceptions = async (
  tree: Tree,
  exceptions: DependencyCheckException[],
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { insertViaGritQL, GRIT_INSERT_PLACEHOLDER } =
    await import('../utils/ast');

  if (!(await hasDependenciesBlock(tree))) {
    return;
  }

  let modified = false;
  for (const exception of exceptions) {
    const pkg = JSON.stringify(exception.package);
    const inserted = await insertViaGritQL(
      tree,
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `\`dependencies: { $scope }\` where {
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
 * Add `pythonCollector()` to `license.dependencies.collectors`, unless one is
 * already configured.
 */
export const ensurePythonLicenseCollector = async (
  tree: Tree,
): Promise<void> => {
  if (!tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) return;

  const { addDestructuredImport, insertViaGritQL, GRIT_INSERT_PLACEHOLDER } =
    await import('../utils/ast');

  if (!(await hasDependenciesBlock(tree))) {
    return;
  }

  const added = await insertViaGritQL(
    tree,
    AWS_NX_PLUGIN_CONFIG_FILE_NAME,
    `\`dependencies: { $scope }\` where {
      $scope <: not contains \`pythonCollector\`,
      ${appendToArray('collectors', '`$_($_)`', GRIT_INSERT_PLACEHOLDER)}
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
    // Now that a Python collector is configured, ensure uv.lock is a cache
    // input. Runs here (not only in the license generator) so it's added
    // whenever the collector is — e.g. when py#project runs after license.
    await updateLicenseCheckTargetInputs(tree);
  }
};

/**
 * Build the default `license.source` config for a given license
 */
export const defaultLicenseConfig = (
  spdx: SPDXLicenseIdentifier,
  copyrightHolder: string,
): LicenseSourceConfig => {
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
 * Write the `license.source` config (headers + LICENSE files) to the aws nx
 * plugin config.
 *
 * The `source` block is (re)written, but any existing `license.dependencies`
 * block — a user-customized allowlist, collectors and exceptions — is
 * preserved, so re-running the license generator (e.g. to change the copyright
 * holder) never clobbers dependency-check customizations.
 */
export const writeLicenseConfig = async (
  tree: Tree,
  source: LicenseSourceConfig,
) => {
  const { captureGritQL } = await import('../utils/ast');

  // Capture the existing `dependencies: { ... }` block before overwriting the
  // license value, so we can re-attach it afterwards. It's managed by the
  // ensure* helpers, never written from here.
  const preserved = tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)
    ? await captureGritQL(
        tree,
        AWS_NX_PLUGIN_CONFIG_FILE_NAME,
        '`dependencies: $_`',
      )
    : undefined;

  await updateAwsNxPluginConfig(tree, { license: { source } });

  // Re-attach the preserved block. The captured text may contain backticks,
  // `${...}` or quotes — prependLicenseProperty routes it through a placeholder
  // so it never enters the GritQL pattern.
  if (preserved) {
    await prependLicenseProperty(tree, preserved);
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
