/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { detectPackageManager } from '@nx/devkit';
import {
  PACKAGE_MANAGER_COMMANDS,
  type PackageManagerDisplayCommands,
} from './commands';

export type { PackageManagerDisplayCommands };

/**
 * Returns display-friendly command prefixes for the detected package manager.
 */
export const getPackageManagerDisplayCommands = (
  pm = detectPackageManager(),
): PackageManagerDisplayCommands =>
  PACKAGE_MANAGER_COMMANDS[pm] ?? PACKAGE_MANAGER_COMMANDS['npm'];
