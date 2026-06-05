/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { detectPackageManager, type Tree } from '@nx/devkit';
import yaml from 'js-yaml';

const WORKSPACE_FILE = 'pnpm-workspace.yaml';

interface PnpmWorkspaceYaml {
  allowBuilds?: Record<string, boolean>;
  onlyBuiltDependencies?: string[];
  ignoreWorkspaceRootCheck?: boolean;
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
  if (detectPackageManager(tree.root) !== 'pnpm') {
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
 * Set `ignoreWorkspaceRootCheck: true` in `pnpm-workspace.yaml` so `pnpm add`
 * from the workspace root does not error with `ERR_PNPM_ADDING_TO_ROOT`.
 *
 * pnpm 11 no longer honours `ignore-workspace-root-check=true` in `.npmrc`;
 * it must live in `pnpm-workspace.yaml` as the camelCased key. pnpm 10 also
 * accepts the yaml form, so writing it here works for both majors.
 *
 * No-op for non-pnpm workspaces or when `pnpm-workspace.yaml` is absent.
 */
export const ensurePnpmIgnoresWorkspaceRootCheck = (tree: Tree): boolean => {
  if (detectPackageManager(tree.root) !== 'pnpm') {
    return false;
  }
  if (!tree.exists(WORKSPACE_FILE)) {
    return false;
  }

  const original = tree.read(WORKSPACE_FILE, 'utf-8') ?? '';
  const parsed = (yaml.load(original) as PnpmWorkspaceYaml | null) ?? {};

  if (parsed.ignoreWorkspaceRootCheck === true) {
    return false;
  }

  parsed.ignoreWorkspaceRootCheck = true;
  tree.write(WORKSPACE_FILE, yaml.dump(parsed, { quotingType: "'" }));
  return true;
};
