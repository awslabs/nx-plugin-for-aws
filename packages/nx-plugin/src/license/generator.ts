/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, readNxJson, Tree, updateNxJson } from '@nx/devkit';
import { LicenseGeneratorSchema } from './schema';
import {
  addLicenseExceptions,
  defaultLicenseConfig,
  restoreDependencyCheckImports,
  writeLicenseConfig,
} from './config';
import { ensureAwsNxPluginConfig } from '../utils/config/utils';
import { SYNC_GENERATOR_NAME } from './sync/generator';
import { NxGeneratorInfo, getGeneratorInfo } from '../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import {
  MCP_INSPECTOR_EXCEPTIONS,
  AG_UI_STRANDS_EXCEPTIONS,
} from './known-exceptions';

export const LICENSE_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

const LICENSE_CHECK_PLUGIN = '@aws/nx-plugin/license-check-plugin';

export async function licenseGenerator(
  tree: Tree,
  options: LicenseGeneratorSchema,
) {
  const { license, copyrightHolder } = options;
  const dependencyCheckEnabled = options.dependencyCheck !== false;

  // Write default config for the license headers
  await ensureAwsNxPluginConfig(tree);
  await writeLicenseConfig(
    tree,
    defaultLicenseConfig(license, copyrightHolder, {
      dependencyCheck: dependencyCheckEnabled,
    }),
  );

  if (dependencyCheckEnabled) {
    const { addDependenciesToPackageJson } = await import('@nx/devkit');
    addDependenciesToPackageJson(
      tree,
      {},
      { 'license-checker-rseidelsohn': '4.4.2' },
    );
    const hasPython = hasPythonProjects(tree);
    await restoreDependencyCheckImports(tree, {
      includeCollectors: hasPython ? 'npm+python' : 'npm',
    });
    await addExceptionsForExistingProjects(tree);
  }

  // Configure sync generator
  const nxJson = readNxJson(tree);
  const lintTargetDefault = {
    ...nxJson.targetDefaults?.lint,
    syncGenerators: [
      ...(nxJson.targetDefaults?.lint?.syncGenerators ?? []).filter(
        (g) => g !== SYNC_GENERATOR_NAME,
      ),
      SYNC_GENERATOR_NAME,
    ],
  };

  const updatedNxJson = {
    ...nxJson,
    targetDefaults: {
      ...nxJson.targetDefaults,
      lint: lintTargetDefault,
    },
  };

  const existingPlugins = (nxJson.plugins ?? []).filter((p) => {
    const name = typeof p === 'string' ? p : p.plugin;
    return name !== LICENSE_CHECK_PLUGIN;
  });
  if (dependencyCheckEnabled) {
    updatedNxJson.plugins = [
      ...existingPlugins,
      { plugin: LICENSE_CHECK_PLUGIN },
    ];
  } else {
    updatedNxJson.plugins =
      existingPlugins.length === 0 ? undefined : existingPlugins;
  }

  updateNxJson(tree, updatedNxJson);

  await addGeneratorMetricsIfApplicable(tree, [LICENSE_GENERATOR_INFO]);
}

const addExceptionsForExistingProjects = async (tree: Tree): Promise<void> => {
  const projects = getProjects(tree);
  let needsMcp = false;
  let needsAgUi = false;

  for (const [, config] of projects) {
    const components =
      (config as any).metadata?.components ??
      (config as any).metadata?.generators ??
      [];
    for (const comp of components) {
      const gen = comp.generator ?? comp;
      if (
        typeof gen === 'string' &&
        (gen.includes('mcp-server') || gen.includes('mcp_server'))
      ) {
        needsMcp = true;
      }
      if (typeof gen === 'string' && gen.includes('agent')) {
        if (comp.protocol === 'AG-UI' || comp.protocol === 'ag-ui') {
          needsAgUi = true;
        }
      }
    }
  }

  const exceptions = [
    ...(needsMcp ? MCP_INSPECTOR_EXCEPTIONS : []),
    ...(needsAgUi ? AG_UI_STRANDS_EXCEPTIONS : []),
  ];

  if (exceptions.length > 0) {
    await addLicenseExceptions(tree, exceptions);
  }
};

const hasPythonProjects = (tree: Tree): boolean => {
  const projects = getProjects(tree);
  for (const [, config] of projects) {
    if (tree.exists(`${config.root}/pyproject.toml`)) return true;
  }
  return tree.exists('pyproject.toml');
};

export default licenseGenerator;
