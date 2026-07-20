/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LicenseConfig } from '../../license/config-types';
import type { ContainersConfig } from '../containers';
import type { IacConfig } from '../iac';

export * from '../../license/config-types';
export type { Containers, ContainersConfig } from '../containers';
export type { Iac, IacConfig } from '../iac';

/**
 * Configuration for how generators manage dependencies via the package manager
 */
export interface PackageManagerConfig {
  /**
   * Whether generators record third-party dependency versions in the package
   * manager's dependency catalog (pnpm/yarn/bun), referencing them as
   * `catalog:` in each project's package.json — keeping a single source of
   * truth for versions across the workspace.
   *
   * When `false`, generators write direct version ranges to each project's
   * package.json instead, and keeping versions aligned across projects is the
   * user's responsibility.
   *
   * Defaults to `true`. Has no effect on npm, which has no catalog feature.
   */
  catalogs?: boolean;
}

/**
 * Configuration for the nx plugin
 */
export interface AwsNxPluginConfig {
  /**
   * Configuration for the license sync generator
   */
  license?: LicenseConfig;

  /**
   * Configuration for infrastructure as code
   */
  iac?: IacConfig;

  /**
   * Configuration for container tooling (build/push/login)
   */
  containers?: ContainersConfig;

  /**
   * Configuration for how generators manage dependencies via the package
   * manager (e.g. whether to use dependency catalogs)
   */
  packageManager?: PackageManagerConfig;

  /**
   * List of tags
   */
  tags?: string[];
}
