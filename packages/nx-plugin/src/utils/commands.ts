/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TS_VERSIONS } from './versions';

/**
 * The nx version the plugin is built against. Commands that download nx
 * (e.g. `nx init`) pin to this version so the workspace's nx matches the
 * plugin's `@nx/*` packages — a mismatch deadlocks `nx sync`.
 */
export const NX_VERSION = TS_VERSIONS['@nx/devkit'];

/**
 * Display-friendly command prefixes for each package manager.
 *
 * - `exec`: prefix for running local binaries (e.g. `npx nx`, `pnpm nx`, `bunx nx`)
 * - `run`: prefix for running package.json scripts (e.g. `npm run build`, `pnpm build`)
 *
 * @see docs/src/components/package-manager-exec-command.astro
 * @see docs/src/components/package-manager-short-command.astro
 */
export interface PackageManagerDisplayCommands {
  /** Prefix for running local binaries: npx, pnpm, yarn, bunx */
  exec: string;
  /** Prefix for running package.json scripts: `npm run`, pnpm, yarn, bun */
  run: string;
  /** Prefix for `create` commands: `npm create`, `pnpm create`, etc. */
  create: string;
}

export const PACKAGE_MANAGER_COMMANDS: Record<
  string,
  PackageManagerDisplayCommands
> = {
  npm: { exec: 'npx', run: 'npm run', create: 'npm create' },
  pnpm: { exec: 'pnpm', run: 'pnpm', create: 'pnpm create' },
  yarn: { exec: 'yarn', run: 'yarn', create: 'yarn create' },
  bun: { exec: 'bunx', run: 'bun', create: 'bun create' },
};

/**
 * Build a package manager exec command (e.g. pnpm cmd, npx cmd, bunx cmd)
 */
export const buildPackageManagerExecCommand = (pm: string, command: string) => {
  const prefix = PACKAGE_MANAGER_COMMANDS[pm]?.exec ?? pm;
  return `${prefix} ${command}`;
};

/**
 * Build a short package manager command (e.g. pnpm build, npm run build)
 */
export const buildPackageManagerShortCommand = (
  pm: string,
  command: string,
) => {
  const prefix = PACKAGE_MANAGER_COMMANDS[pm]?.run ?? pm;
  return `${prefix} ${command}`;
};

// Build an install command. With `project`, targets that project's manifest
// (pnpm `--filter` by unscoped name, npm/bun by `projectDir` defaulting to
// `packages/<name>`, yarn by fully-qualified name); otherwise the root.
export const buildInstallCommand = (
  pm: string,
  pkg: string,
  dev: boolean,
  project?: string,
  projectDir?: string,
) => {
  if (project) {
    const shortName = project.split('/').pop();
    const dir = projectDir ?? `packages/${shortName}`;
    switch (pm) {
      case 'pnpm':
        return `pnpm add ${dev ? '-D ' : ''}${pkg} --filter ${shortName}`;
      case 'yarn':
        return `yarn workspace ${project} add ${dev ? '-D ' : ''}${pkg}`;
      case 'npm':
        return `npm install --legacy-peer-deps ${dev ? '-D ' : ''}${pkg} -w ${dir}`;
      case 'bun':
        return `bun add ${dev ? '-D ' : ''}${pkg} --cwd ${dir}`;
      default:
        return `${pm} install ${dev ? '-D ' : ''}${pkg}`;
    }
  }
  switch (pm) {
    case 'pnpm':
      return `pnpm add ${dev ? '-D' : '-'}w ${pkg}`;
    case 'yarn':
      return `yarn add ${dev ? '-D ' : ''}${pkg}`;
    case 'npm':
      return `npm install --legacy-peer-deps ${dev ? '-D ' : ''}${pkg}`;
    case 'bun':
      return `bun add ${dev ? '-D ' : ''}${pkg}`;
    default:
      return `${pm} install ${dev ? '-D ' : ''}${pkg}`;
  }
};

/**
 * Build the command that adds Nx to a non-Nx project, pinned to the nx
 * version the plugin is built against.
 */
export const buildNxInitCommand = (pm: string) => {
  const dlxPrefix =
    { npm: 'npx', pnpm: 'pnpm dlx', yarn: 'yarn dlx', bun: 'bunx' }[pm] ??
    'npx';
  return `${dlxPrefix} nx@${NX_VERSION} init`;
};

/**
 * Build a command to create a new workspace using @aws/create-nx-workspace.
 *
 * Uses the `create` shorthand for each package manager:
 *   npm create @aws/nx-workspace my-project
 *   pnpm create @aws/nx-workspace my-project
 *   yarn create @aws/nx-workspace my-project
 *   bun create @aws/nx-workspace my-project
 *
 * The package manager is auto-detected by @aws/create-nx-workspace from the
 * invoking command, so --pm is not needed.
 */
export const buildCreateNxWorkspaceCommand = (
  pm: string,
  workspace: string,
  iac?: 'cdk' | 'terraform',
  tag?: string,
  module?: 'esm' | 'cjs',
  extraArgs?: string,
) => {
  const createPrefix = PACKAGE_MANAGER_COMMANDS[pm]?.create ?? `${pm} create`;
  const pkgName = tag ? `@aws/nx-workspace@${tag}` : '@aws/nx-workspace';
  const parts = [
    createPrefix,
    pkgName,
    // npm requires '--' to stop interpreting subsequent flags as npm config
    ...(pm === 'npm' ? ['--'] : []),
    workspace,
    ...(iac ? [`--iac=${iac}`] : []),
    ...(module ? [`--module=${module}`] : []),
    ...(extraArgs ? [extraArgs] : []),
  ];
  return parts.join(' ');
};
