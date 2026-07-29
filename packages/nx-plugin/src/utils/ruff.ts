/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-nodejs';
import path from 'path';

/**
 * Rules whose fixes are applied to generated Python.
 *
 * `ruff_wasm`'s `check` serialises every fix without its applicability, and
 * ignores `unsafe-fixes`, so it cannot be asked for only the fixes `ruff check
 * --fix` would apply — taking them all would rewrite `if x == True` to `if x`.
 * Ruff's `fixable` setting filters inside the linter, so naming rules here keeps
 * the decision in ruff rather than reimplementing applicability.
 *
 * Deliberately narrow rather than an enumeration of every safe fix: 141 rules
 * under the vended selection offer one, and a list that size would silently
 * drift from ruff's applicability on each release — the very thing this must not
 * do. These four cover the import hygiene generation itself creates by merging
 * imports into existing files, which is what generated code needs fixed. Other
 * violations are avoided in the templates and left to the user's own `lint
 * --configuration=fix`, so generation never rewrites code beyond its own doing.
 */
const FIXABLE_RULES = ['I001', 'F401', 'F811', 'E401'];

/** Escape hatch matching ruff's own fix loop bound. */
const MAX_FIX_ITERATIONS = 100;

/**
 * The ruff release these bindings are built from. `@astral-sh/ruff-wasm-nodejs`
 * is published from the ruff repo on every release, so its versions track ruff's
 * exactly — keep this in step with `PY_VERSIONS.ruff` (the ruff the vended
 * `format` and `lint` targets run) so generated files stay `ruff format
 * --check`-clean on disk. A test asserts the two agree.
 */
export const RUFF_WASM_VERSION = Workspace.version();

interface Location {
  readonly row: number;
  readonly column: number;
}

interface Edit {
  readonly content: string | null;
  readonly location: Location;
  readonly end_location: Location;
}

interface Diagnostic {
  readonly fix: { readonly edits: readonly Edit[] } | null;
}

/** Ruff settings, as accepted by the WASM `Workspace` constructor. */
export interface RuffOptions {
  readonly 'line-length'?: number;
  readonly 'target-version'?: string;
  readonly lint?: {
    readonly select?: readonly string[];
    readonly 'extend-select'?: readonly string[];
    readonly fixable?: readonly string[];
    readonly unfixable?: readonly string[];
    readonly isort?: { readonly 'known-first-party'?: readonly string[] };
  };
}

/**
 * Apply one diagnostic's fix, resolving ruff's (row, column) positions against
 * the content. Positions are requested in UTF-16, which is how JavaScript
 * already indexes strings, so they need no transcoding.
 */
const applyFix = (content: string, edits: readonly Edit[]): string => {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  // Ruff can report a position one past the last line (eg when deleting a
  // trailing line), so clamp rather than indexing past the end.
  const offsetOf = (location: Location): number =>
    (lineStarts[location.row - 1] ?? content.length) + (location.column - 1);

  let result = '';
  let end = 0;
  for (const edit of [...edits].sort(
    (a, b) => offsetOf(a.location) - offsetOf(b.location),
  )) {
    const start = offsetOf(edit.location);
    if (start < end) {
      continue;
    }
    result += content.slice(end, start) + (edit.content ?? '');
    end = offsetOf(edit.end_location);
  }
  return result + content.slice(end);
};

/**
 * Ruff treats an `__init__.py` as re-exporting its imports, so an unused import
 * there gets a diagnostic with no fix — removing it would drop the package's
 * public API. `ruff_wasm` lints under a fixed placeholder filename and so cannot
 * apply this itself, making the file's real name the caller's to account for.
 */
const isInitPy = (filePath: string): boolean =>
  path.basename(filePath) === '__init__.py';

/**
 * A `Workspace` costs far more to construct than to run, and the same settings
 * recur across every file of a project, so key them by the resolved options.
 */
const _workspaces = new Map<string, Workspace>();
const getWorkspace = (options: RuffOptions): Workspace => {
  const key = JSON.stringify(options);
  let workspace = _workspaces.get(key);
  if (!workspace) {
    workspace = new Workspace(options, PositionEncoding.Utf16);
    _workspaces.set(key, workspace);
  }
  return workspace;
};

/**
 * Apply ruff's lint fixes and formatter to Python content, in process.
 *
 * Equivalent to piping the content through `ruff check --fix` then `ruff
 * format` — the tools the vended `lint` and `format` targets run — without
 * paying two process spawns per file.
 */
export const ruffFixAndFormat = (
  content: string,
  filePath: string,
  options: RuffOptions,
): string => {
  const workspace = getWorkspace({
    ...options,
    lint: {
      ...options.lint,
      fixable: FIXABLE_RULES,
      // Never drop an `__init__.py` import: ruff keeps these as re-exports.
      ...(isInitPy(filePath) ? { unfixable: ['F401'] } : {}),
    },
  });

  // Apply a single fix per pass and re-lint, as ruff does until the content
  // stabilises. Taking one fix at a time leaves ruff to decide what is
  // applicable against the current content, rather than reproducing how it
  // batches, orders and skips overlapping fixes within a pass.
  for (let i = 0; i < MAX_FIX_ITERATIONS; i++) {
    let diagnostic: Diagnostic | undefined;
    try {
      diagnostic = (workspace.check(content) as Diagnostic[]).find(
        (d) => d.fix && d.fix.edits.length > 0,
      );
    } catch {
      // Content that does not parse has nothing to fix; still try to format it.
      break;
    }
    if (!diagnostic?.fix) {
      break;
    }
    const fixed = applyFix(content, diagnostic.fix.edits);
    if (fixed === content) {
      break;
    }
    content = fixed;
  }

  try {
    return workspace.format(content);
  } catch {
    // Leave content the formatter rejects (eg a syntax error) as-is.
    return content;
  }
};
