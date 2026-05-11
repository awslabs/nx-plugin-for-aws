/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'child_process';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { TS_VERSIONS } from '../../nx-plugin/src/utils/versions';

const NX_VERSION = TS_VERSIONS['create-nx-workspace'];
const PRESET = '@aws/nx-plugin';
const DEFAULT_FLAGS = ['--ci=skip', '--analytics=false'];

/**
 * Detect the package manager from the npm_config_user_agent environment variable.
 * This is set by package managers when running scripts/bins.
 */
export const detectPackageManager = (): string | undefined => {
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return undefined;
  if (userAgent.startsWith('pnpm/')) return 'pnpm';
  if (userAgent.startsWith('yarn/')) return 'yarn';
  if (userAgent.startsWith('bun/')) return 'bun';
  if (userAgent.startsWith('npm/')) return 'npm';
  return undefined;
};

/**
 * Detect whether the user has requested non-interactive mode
 * (`--no-interactive` or `--interactive=false`).
 */
const isNonInteractive = (flagArgs: string[]): boolean =>
  flagArgs.some((a) => a === '--no-interactive' || a === '--interactive=false');

/**
 * Detect whether the user has already specified --skipGit in any form
 * (`--skipGit`, `--skipGit=true|false`, `--no-skipGit`).
 */
const hasSkipGitFlag = (flagArgs: string[]): boolean =>
  flagArgs.some(
    (a) =>
      a === '--skipGit' || a.startsWith('--skipGit=') || a === '--no-skipGit',
  );

/**
 * Read the value of a repeated-CLI-style flag (e.g. extract `yes` from
 * `--ci=yes`). Returns the last occurrence or `undefined` if unset.
 */
const readFlagValue = (
  flagArgs: string[],
  ...aliases: string[]
): string | undefined => {
  const prefixes = aliases.flatMap((a) => [`--${a}=`, `-${a}=`]);
  for (let i = flagArgs.length - 1; i >= 0; i--) {
    const match = prefixes.find((p) => flagArgs[i].startsWith(p));
    if (match) {
      return flagArgs[i].slice(match.length);
    }
  }
  return undefined;
};

/**
 * Detect whether the user has opted into the CI / Nx Cloud push flow in a
 * way that would trigger nx's `Would you like to push this workspace to
 * GitHub?` prompt inside `pushToGitHub` (see create-nx-workspace's
 * `src/utils/git/git.js`). That prompt is the ONLY git-related prompt
 * reachable under `--no-interactive`: all other git handling in
 * `src/create-workspace.js` runs silently via `initializeGitRepo` with no
 * enquirer calls.
 *
 * `pushToGitHub` is only reached when `nxCloud ∈ { 'github', 'yes' }`
 * (create-workspace.js:150). `--ci` is the CLI alias of `--nxCloud`
 * (yargs-options.js:16). Our wrapper defaults `--ci=skip`, so the prompt
 * is unreachable on the default path — but a user can override with
 * e.g. `--ci=github`, and that override combined with `--no-interactive`
 * would hang on the push prompt because nx never gates it on
 * `parsedArgs.interactive`.
 */
const triggersGitHubPushPrompt = (flagArgs: string[]): boolean => {
  const value =
    readFlagValue(flagArgs, 'nxCloud', 'ci') ??
    (flagArgs.includes('--nxCloud') || flagArgs.includes('--ci')
      ? 'yes'
      : undefined);
  return value === 'yes' || value === 'github';
};

/**
 * Build the argument list for create-nx-workspace.
 * Positional args come first, then --preset and defaults, then user flags.
 */
export const buildArgs = (args: string[]): string[] => {
  const positionalArgs = args.filter((a) => !a.startsWith('-'));
  const flagArgs = args.filter((a) => a.startsWith('-'));

  const defaultFlags = [...DEFAULT_FLAGS];

  // Auto-detect and add --pm if not explicitly provided
  if (!flagArgs.some((a) => a.startsWith('--pm'))) {
    const pm = detectPackageManager();
    if (pm) {
      defaultFlags.push(`--pm=${pm}`);
    }
  }

  // `--no-interactive` alone is normally sufficient: with our default
  // `--ci=skip`, nx never reaches the GitHub-push prompt. But if the user
  // overrides with `--ci=yes` / `--ci=github` / `--nxCloud=yes|github`, nx
  // WILL try to prompt for "push to GitHub?" even under `--no-interactive`
  // — that prompt is not gated on the interactive flag. In that specific
  // combination, default to `--skipGit` so a single `--no-interactive`
  // still runs unattended. The user can opt back in with explicit
  // `--no-skipGit` or `--skipGit=false`.
  if (
    isNonInteractive(flagArgs) &&
    triggersGitHubPushPrompt(flagArgs) &&
    !hasSkipGitFlag(flagArgs)
  ) {
    defaultFlags.push('--skipGit');
  }

  const flagsToAdd = defaultFlags.filter(
    (flag) => !flagArgs.some((a) => a.startsWith(flag.split('=')[0])),
  );

  return [...positionalArgs, `--preset=${PRESET}`, ...flagsToAdd, ...flagArgs];
};

/**
 * Create a new Nx workspace with the @aws/nx-plugin preset.
 * All arguments are forwarded to create-nx-workspace.
 */
export const createNxWorkspace = (args: string[]): number => {
  const hasPreset = args.some((a) => a.startsWith('--preset'));
  if (hasPreset) {
    console.error(
      `Error: --preset cannot be used with @aws/create-nx-workspace.\n` +
        `This package always creates a workspace with the ${PRESET} preset.\n` +
        `To use a different preset, run create-nx-workspace directly:\n\n` +
        `  npx create-nx-workspace <name> --preset=<your-preset>\n`,
    );
    return 1;
  }

  const allArgs = buildArgs(args);

  // Use npx to run create-nx-workspace to avoid bin name collision between
  // this package (@aws/create-nx-workspace) and the create-nx-workspace dep.
  const result = spawnSync(
    'npx',
    ['-y', `create-nx-workspace@${NX_VERSION}`, ...allArgs],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        // pnpm 11 defaults strictDepBuilds=true, which turns the initial
        // `pnpm install --no-frozen-lockfile` run by `nx new` into a hard
        // error on nx's postinstall script — before our preset generator
        // gets a chance to write the workspace's pnpm-workspace.yaml. pnpm
        // reads config from the lowercase `pnpm_config_` env-var prefix.
        // Harmless under pnpm 10.
        pnpm_config_strict_dep_builds: 'false',
      },
      shell: process.platform === 'win32',
    },
  );

  return result.status ?? 1;
};
