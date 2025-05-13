/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createProjectGraphAsync } from '@nx/devkit';

// Global Setup https://vitest.dev/config/#globalsetup
export default async () => {
  // Create the project graph in global setup to ensure it's cached in the daemon
  await createProjectGraphAsync();
};
