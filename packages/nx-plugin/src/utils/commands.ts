/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
 * Build a create-nx-workspace command
 */
export const buildCreateNxWorkspaceCommand = (
  pm: string,
  workspace: string,
  iacProvider?: 'CDK' | 'Terraform',
  nxVersion?: string,
  nxPluginVersion?: string,
) =>
  `npx -y create-nx-workspace${nxVersion ? `@${nxVersion}` : ''} ${workspace} --pm=${pm} --preset=@aws/nx-plugin${nxPluginVersion ? `@${nxPluginVersion}` : ''}${iacProvider ? ` --iacProvider=${iacProvider}` : ''} --ci=skip`;

/**
 * Build a short package manager command (e.g. pnpm build, npm run build)
 */
export const buildPackageManagerShortCommand = (pm: string, command: string) =>
  pm === 'npm' ? `npm run ${command}` : `${pm} ${command}`;
