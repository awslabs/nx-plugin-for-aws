/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TS_VERSIONS } from './versions';

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
}

export const PACKAGE_MANAGER_COMMANDS: Record<
  string,
  PackageManagerDisplayCommands
> = {
  npm: { exec: 'npx', run: 'npm run' },
  pnpm: { exec: 'pnpm', run: 'pnpm' },
  yarn: { exec: 'yarn', run: 'yarn' },
  bun: { exec: 'bunx', run: 'bun' },
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

/**
 * Build an install command for a given package manager
 */
export const buildInstallCommand = (pm: string, pkg: string, dev: boolean) => {
  switch (pm) {
    case 'pnpm':
      return `pnpm add ${dev ? '-D' : '-'}w ${pkg}`;
    case 'yarn':
      return `yarn add ${dev ? '-D ' : ''}${pkg}`;
    case 'npm':
      return `npm install --legacy-peer-deps ${dev ? '-D ' : ''}${pkg}`;
    case 'bun':
      return `bun install ${dev ? '-D ' : ''}${pkg}`;
    default:
      return `${pm} install ${dev ? '-D ' : ''}${pkg}`;
  }
};

/**
 * Build a create-nx-workspace command.
 * Defaults to the pinned create-nx-workspace version from TS_VERSIONS.
 */
export const buildCreateNxWorkspaceCommand = (
  pm: string,
  workspace: string,
  iacProvider?: 'CDK' | 'Terraform',
  yes = false,
  nxVersion: string = TS_VERSIONS['create-nx-workspace'],
  nxPluginVersion?: string,
) =>
  `npx ${yes ? '-y ' : ''}create-nx-workspace@${nxVersion} ${workspace} --pm=${pm} --preset=@aws/nx-plugin${nxPluginVersion ? `@${nxPluginVersion}` : ''}${iacProvider ? ` --iacProvider=${iacProvider}` : ''} --ci=skip --analytics=false --aiAgents`;
