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
    { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
  );

  return result.status ?? 1;
};
