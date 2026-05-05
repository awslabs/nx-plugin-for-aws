/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { detectPackageManager, Tree } from '@nx/devkit';

const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/**
 * An `allowBuilds` entry decision for pnpm 11 (and the corresponding
 * presence in `onlyBuiltDependencies` for pnpm 10).
 *
 *   - `true`  → run the dep's install scripts.
 *   - `false` → known build-script dep that we've reviewed and *don't*
 *               want to run. Tells pnpm 11 it's allowlisted so installs
 *               don't hard-error under the default `strictDepBuilds=true`,
 *               but the script is still skipped. No pnpm 10 equivalent —
 *               pnpm 10's `onlyBuiltDependencies` simply omits the entry.
 */
export type PnpmAllowBuildsDecision = true | false;

/**
 * Merge entries into the generated workspace's pnpm-workspace.yaml
 * allowlists. No-op for non-pnpm workspaces.
 *
 * Generators call this when they introduce a dependency whose install
 * script pnpm would otherwise reject under pnpm 11's default
 * `strictDepBuilds=true`. Keeping the allowlist explicit (rather than
 * globally disabling strictness) preserves the supply-chain audit pnpm 11
 * intends — each build-script dep is reviewed by the generator author.
 */
export const registerPnpmBuiltDependencies = (
  tree: Tree,
  entries: Record<string, PnpmAllowBuildsDecision>,
): void => {
  if (detectPackageManager(tree.root) !== 'pnpm') {
    return;
  }
  if (!tree.exists(WORKSPACE_FILE)) {
    return;
  }

  // Naive line-based merge: we write the file ourselves from the preset,
  // so the structure is predictable (block keys under `allowBuilds:` and
  // `onlyBuiltDependencies:` that we own). Using a yaml library here
  // would be heavier and drag in formatter round-trip quirks we've
  // already been bitten by.
  const contents = tree.read(WORKSPACE_FILE, 'utf-8') ?? '';
  let updated = contents;
  for (const [pkg, decision] of Object.entries(entries)) {
    updated = mergeAllowBuildsEntry(updated, pkg, decision);
    if (decision === true) {
      updated = mergeOnlyBuiltDependenciesEntry(updated, pkg);
    }
  }
  if (updated !== contents) {
    tree.write(WORKSPACE_FILE, updated);
  }
};

const mergeAllowBuildsEntry = (
  contents: string,
  pkg: string,
  decision: PnpmAllowBuildsDecision,
): string => {
  const quoted = `'${pkg}'`;
  const blockStart = contents.indexOf('\nallowBuilds:');
  if (blockStart === -1) {
    // No allowBuilds block — append one at end.
    return (
      contents.replace(/\n?$/, '\n') +
      `allowBuilds:\n  ${quoted}: ${decision}\n`
    );
  }
  const blockEnd = findBlockEnd(contents, blockStart + 1);
  const block = contents.slice(blockStart, blockEnd);
  const entryRe = new RegExp(
    `^\\s+['"]?${escapeRegExp(pkg)}['"]?:\\s*(true|false).*$`,
    'm',
  );
  if (entryRe.test(block)) {
    return (
      contents.slice(0, blockStart) +
      block.replace(entryRe, `  ${quoted}: ${decision}`) +
      contents.slice(blockEnd)
    );
  }
  return (
    contents.slice(0, blockEnd) +
    `  ${quoted}: ${decision}\n` +
    contents.slice(blockEnd)
  );
};

const mergeOnlyBuiltDependenciesEntry = (
  contents: string,
  pkg: string,
): string => {
  const quoted = `'${pkg}'`;
  const blockStart = contents.indexOf('\nonlyBuiltDependencies:');
  if (blockStart === -1) {
    return (
      contents.replace(/\n?$/, '\n') + `onlyBuiltDependencies:\n  - ${quoted}\n`
    );
  }
  const blockEnd = findBlockEnd(contents, blockStart + 1);
  const block = contents.slice(blockStart, blockEnd);
  const entryRe = new RegExp(
    `^\\s+-\\s+['"]?${escapeRegExp(pkg)}['"]?\\s*$`,
    'm',
  );
  if (entryRe.test(block)) {
    return contents;
  }
  return (
    contents.slice(0, blockEnd) + `  - ${quoted}\n` + contents.slice(blockEnd)
  );
};

const findBlockEnd = (contents: string, startOfBlock: number): number => {
  // Start after the block header line. Walk forwards, treating any line
  // that isn't indented (and isn't a blank line) as the start of the next
  // top-level key.
  const afterHeader = contents.indexOf('\n', startOfBlock);
  if (afterHeader === -1) return contents.length;
  let i = afterHeader + 1;
  while (i < contents.length) {
    const nextNewline = contents.indexOf('\n', i);
    const line = contents.slice(
      i,
      nextNewline === -1 ? undefined : nextNewline,
    );
    const isIndented = line.startsWith(' ') || line.startsWith('\t');
    const isBlank = line.trim().length === 0;
    if (!isIndented && !isBlank) {
      return i;
    }
    if (nextNewline === -1) {
      return contents.length;
    }
    i = nextNewline + 1;
  }
  return contents.length;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
