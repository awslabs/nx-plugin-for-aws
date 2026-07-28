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
   * Whether generators record dependency versions in the package manager's
   * catalog (pnpm/yarn/bun) via `catalog:` refs. When `false`, direct version
   * ranges are written to each project. Defaults to `true`; no effect on npm.
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
