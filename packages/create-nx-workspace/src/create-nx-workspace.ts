/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { TS_VERSIONS } from '../../nx-plugin/src/utils/versions';

const NX_VERSION = TS_VERSIONS['create-nx-workspace'];
const OWN_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
).version;
const PRESET = `@aws/nx-plugin@${OWN_VERSION}`;
const DEFAULT_FLAGS = [
  '--ci=skip',
  '--analytics=false',
  '--trustThirdPartyPreset',
];

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

export const shouldSkipGit = (flagArgs: string[]): boolean =>
  flagArgs.some((a) => a === '--skipGit' || a === '--skipGit=true');

/**
 * Determine whether the given directory is already inside a git repository.
 */
export const isGitRepo = (dir: string): boolean => {
  if (!existsSync(dir)) return false;
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: dir,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  return result.status === 0 && result.stdout?.toString().trim() === 'true';
};

export const buildArgs = (args: string[]): string[] => {
  // Treat only tokens before the first flag as positional (the workspace name);
  // everything from the first flag on keeps its order so flag/value pairs like
  // `--catalog false` stay together.
  const firstFlagIndex = args.findIndex((a) => a.startsWith('-'));
  const positionalArgs =
    firstFlagIndex === -1 ? args : args.slice(0, firstFlagIndex);
  const restArgs = firstFlagIndex === -1 ? [] : args.slice(firstFlagIndex);

  const defaultFlags = [...DEFAULT_FLAGS, '--skipGit'];

  if (!restArgs.some((a) => a.startsWith('--pm'))) {
    const pm = detectPackageManager();
    if (pm) defaultFlags.push(`--pm=${pm}`);
  }

  const userArgsWithoutSkipGit = restArgs.filter(
    (a) => !a.startsWith('--skipGit'),
  );

  const flagsToAdd = defaultFlags.filter(
    (flag) =>
      !userArgsWithoutSkipGit.some((a) => a.startsWith(flag.split('=')[0])),
  );

  return [
    ...positionalArgs,
    `--preset=${PRESET}`,
    ...flagsToAdd,
    ...userArgsWithoutSkipGit,
  ];
};

const initGitRepo = (dir: string): void => {
  const shell = process.platform === 'win32';

  spawnSync('git', ['init'], { cwd: dir, stdio: 'pipe' });

  // Run the prepare script (husky) to configure git hooks now that .git exists
  const pm = detectPackageManager() ?? 'npm';
  spawnSync(pm, ['run', 'prepare'], { cwd: dir, stdio: 'pipe', shell });

  spawnSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', 'Initial commit'], {
    cwd: dir,
    stdio: 'pipe',
  });
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
        `This package always creates a workspace with the @aws/nx-plugin preset.\n` +
        `To use a different preset, run create-nx-workspace directly:\n\n` +
        `  npx create-nx-workspace <name> --preset=<your-preset>\n`,
    );
    return 1;
  }

  const flagArgs = args.filter((a) => a.startsWith('-'));
  const skipGit = shouldSkipGit(flagArgs);

  const allArgs = buildArgs(args);

  // Use npx to run create-nx-workspace to avoid bin name collision between
  // this package (@aws/create-nx-workspace) and the create-nx-workspace dep.
  const result = spawnSync(
    'npx',
    ['-y', `create-nx-workspace@${NX_VERSION}`, ...allArgs],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    return result.status ?? 1;
  }

  if (!skipGit) {
    const positionalArgs = args.filter((a) => !a.startsWith('-'));
    const workspaceName = positionalArgs[0];
    if (workspaceName) {
      const workspaceDir = resolve(workspaceName);
      // Skip git init if the target directory is already a git repository
      if (!isGitRepo(workspaceDir)) {
        initGitRepo(workspaceDir);
      }
    }
  }

  return 0;
};
