/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
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
