/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface ConfigureProjectOptions {
  /**
   * Full package name including scope (eg @foo/bar)
   */
  readonly fullyQualifiedName: string;
  /**
   * Directory of the project relative to the root
   */
  readonly dir: string;
  /**
   * Whether the project uses ES modules. When false, the project is configured
   * for CommonJS (tsconfig `module`/`moduleResolution`, no root `type: module`).
   * Defaults to true (ESM) when not specified.
   */
  readonly esm?: boolean;
}
