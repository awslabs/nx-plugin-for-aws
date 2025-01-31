/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, readNxJson, Tree, updateNxJson } from '@nx/devkit';
import { join } from 'path';
import { LicenseGeneratorSchema } from './schema';
import { defaultLicenseConfig, writeLicenseConfig } from './config';
import { ensureAwsNxPluginConfig } from '../utils/config/utils';
import { SYNC_GENERATOR_NAME } from './sync/generator';

export async function licenseGenerator(
  tree: Tree,
  options: LicenseGeneratorSchema,
) {
  const { license, copyrightHolder } = options;

  // Add LICENSE file
  generateFiles(tree, join(__dirname, 'files', 'licenses', license), '.', {
    ...options,
    year: new Date().getFullYear(),
  });

  // Write default config for the license headers
  await ensureAwsNxPluginConfig(tree);
  await writeLicenseConfig(
    tree,
    license,
    defaultLicenseConfig(license, copyrightHolder),
  );

  // Configure sync generator to run as part of all projects' lint target
  const nxJson = readNxJson(tree);
  updateNxJson(tree, {
    ...nxJson,
    targetDefaults: {
      ...nxJson.targetDefaults,
      lint: {
        ...nxJson.targetDefaults?.lint,
        syncGenerators: [
          ...(nxJson.targetDefaults?.lint?.syncGenerators ?? []).filter(
            (g) => g !== SYNC_GENERATOR_NAME,
          ),
          SYNC_GENERATOR_NAME,
        ],
      },
    },
  });
}

export default licenseGenerator;
