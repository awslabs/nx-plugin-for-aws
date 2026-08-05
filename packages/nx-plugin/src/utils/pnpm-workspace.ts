/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import yaml from 'js-yaml';
import { detectWorkspacePackageManager } from './dependencies';

const WORKSPACE_FILE = 'pnpm-workspace.yaml';

interface PnpmWorkspaceYaml {
  allowBuilds?: Record<string, boolean>;
  onlyBuiltDependencies?: string[];
  [key: string]: unknown;
}

/**
 * Merge `allowBuilds` (pnpm 11) / `onlyBuiltDependencies` (pnpm 10) entries
 * into the generated workspace's `pnpm-workspace.yaml`. No-op for non-pnpm
 * workspaces.
 *
 * Generators call this when they introduce a dependency whose install
 * script pnpm would otherwise reject under pnpm 11's default
 * `strictDepBuilds=true`. Keeping the allowlist explicit — rather than
 * globally disabling strictness — preserves the supply-chain audit pnpm 11
 * intends: each build-script dep is reviewed by the generator author and
 * entered as either `true` (run the script) or `false` (known dep we
 * don't want to run but have seen).
 *
 * Only `true` entries are also added to `onlyBuiltDependencies` (pnpm 10's
 * allowlist has no equivalent of the `false` decision).
 */
export const registerPnpmBuiltDependencies = (
  tree: Tree,
  entries: Record<string, boolean>,
): void => {
  if (detectWorkspacePackageManager(tree) !== 'pnpm') {
    return;
  }
  if (!tree.exists(WORKSPACE_FILE)) {
    return;
  }

  const original = tree.read(WORKSPACE_FILE, 'utf-8') ?? '';
  const parsed = (yaml.load(original) as PnpmWorkspaceYaml | null) ?? {};

  const allowBuilds = { ...(parsed.allowBuilds ?? {}) };
  const onlyBuiltDependencies = new Set(parsed.onlyBuiltDependencies ?? []);
  let changed = false;

  for (const [pkg, decision] of Object.entries(entries)) {
    if (allowBuilds[pkg] !== decision) {
      allowBuilds[pkg] = decision;
      changed = true;
    }
    if (decision === true && !onlyBuiltDependencies.has(pkg)) {
      onlyBuiltDependencies.add(pkg);
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  parsed.allowBuilds = allowBuilds;
  parsed.onlyBuiltDependencies = [...onlyBuiltDependencies];

  tree.write(WORKSPACE_FILE, yaml.dump(parsed, { quotingType: "'" }));
};

/**
 * Allow a dependency's install scripts to run, whichever package manager the
 * workspace uses.
 *
 * pnpm, bun and yarn Berry all refuse install scripts by default, and each keeps
 * its allowlist somewhere different; only npm and yarn classic run them with
 * nothing recorded. A package that fetches its own binary in a `preinstall` —
 * `mise` does — is otherwise installed with no binary at all, and bun and yarn
 * both fail *silently*, so it surfaces only when a build target runs it.
 *
 * @param entries package -> whether to run its scripts. A `false` entry is
 *   recorded for pnpm (a reviewed dep we deliberately don't build); the other
 *   managers have no equivalent, so it is simply omitted there.
 */
export const registerBuiltDependencies = (
  tree: Tree,
  entries: Record<string, boolean>,
): void => {
  registerPnpmBuiltDependencies(tree, entries);
  registerBunTrustedDependencies(tree, entries);
  registerYarnBuiltDependencies(tree, entries);
};

/** The packages an entry set opts into building. */
const builtPackages = (entries: Record<string, boolean>): string[] =>
  Object.entries(entries)
    .filter(([, decision]) => decision)
    .map(([pkg]) => pkg);

/**
 * Mark dependencies as built in the root package.json's `dependenciesMeta`.
 * No-op for non-yarn workspaces.
 *
 * Yarn Berry disables every package's build scripts unless it is opted in here.
 * Yarn classic runs them regardless and ignores the field, so recording it is
 * harmless there and saves branching on the major version.
 */
const registerYarnBuiltDependencies = (
  tree: Tree,
  entries: Record<string, boolean>,
): void => {
  if (detectWorkspacePackageManager(tree) !== 'yarn') {
    return;
  }
  if (!tree.exists('package.json')) {
    return;
  }

  const built = builtPackages(entries);
  if (built.length === 0) {
    return;
  }

  updateJson(tree, 'package.json', (packageJson) => {
    const meta = { ...(packageJson.dependenciesMeta ?? {}) };
    let changed = false;
    for (const pkg of built) {
      if (meta[pkg]?.built !== true) {
        meta[pkg] = { ...meta[pkg], built: true };
        changed = true;
      }
    }
    // Only rewrite when something is actually new, so a re-run is a no-op.
    if (changed) {
      packageJson.dependenciesMeta = meta;
    }
    return packageJson;
  });
};

/**
 * Add `trustedDependencies` entries to the generated workspace's root
 * package.json. No-op for non-bun workspaces.
 *
 * Bun skips every dependency's lifecycle scripts unless the package is listed
 * here — and unlike pnpm it fails silently, leaving a package installed but
 * unusable rather than erroring at install time.
 */
const registerBunTrustedDependencies = (
  tree: Tree,
  entries: Record<string, boolean>,
): void => {
  if (detectWorkspacePackageManager(tree) !== 'bun') {
    return;
  }
  if (!tree.exists('package.json')) {
    return;
  }

  const trusted = builtPackages(entries);
  if (trusted.length === 0) {
    return;
  }

  updateJson(tree, 'package.json', (packageJson) => {
    const existing: string[] = packageJson.trustedDependencies ?? [];
    const merged = [...new Set([...existing, ...trusted])].sort();
    // Only rewrite when something is actually new, so a re-run is a no-op.
    if (merged.length !== existing.length) {
      packageJson.trustedDependencies = merged;
    }
    return packageJson;
  });
};
