/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, readNxJson, Tree, updateNxJson } from '@nx/devkit';
import { LicenseGeneratorSchema } from './schema';
import {
  defaultLicenseConfig,
  ensureDependencyCheckBlock,
  ensureLicenseExceptions,
  ensurePythonLicenseCollector,
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
import { TS_MCP_SERVER_GENERATOR_INFO } from '../ts/mcp-server/generator';
import { PY_MCP_SERVER_GENERATOR_INFO } from '../py/mcp-server/generator';
import { PY_AGENT_GENERATOR_INFO } from '../py/agent/generator';

export const LICENSE_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function licenseGenerator(
  tree: Tree,
  options: LicenseGeneratorSchema,
) {
  const { license, copyrightHolder } = options;
  const dependencyCheckEnabled = options.dependencyCheck !== false;

  await ensureAwsNxPluginConfig(tree);
  await writeLicenseConfig(
    tree,
    defaultLicenseConfig(license, copyrightHolder),
  );

  if (dependencyCheckEnabled) {
    const hasPython = hasPythonProjects(tree);
    await ensureDependencyCheckBlock(tree, {
      includeCollectors: hasPython ? 'npm+python' : 'npm',
    });
    // When the dependencyCheck block already existed (e.g. on a re-run after
    // python projects were added), the block above is a no-op — so explicitly
    // ensure the python collector is present. This is idempotent.
    if (hasPython) {
      await ensurePythonLicenseCollector(tree);
    }
    await addExceptionsForExistingProjects(tree);
    writeLicenseCheckTarget(tree);
  }

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

  updateNxJson(tree, updatedNxJson);

  await addGeneratorMetricsIfApplicable(tree, [LICENSE_GENERATOR_INFO]);
}

/**
 * Lockfile glob inputs for the license-check cache.
 *
 * Globs (rather than only lockfiles that exist at generation time) ensure the
 * cache invalidates whenever dependencies change anywhere in the workspace —
 * including Python (`uv.lock`) projects added after the license generator runs,
 * whose lockfiles may live in subdirectories of a uv workspace.
 */
const LICENSE_CHECK_LOCKFILE_INPUTS = [
  '{workspaceRoot}/pnpm-lock.yaml',
  '{workspaceRoot}/yarn.lock',
  '{workspaceRoot}/package-lock.json',
  '{workspaceRoot}/bun.lockb',
  '{workspaceRoot}/**/uv.lock',
];

/**
 * Write/update root project.json with license-check target
 */
const writeLicenseCheckTarget = (tree: Tree): void => {
  const rootProjectJsonPath = 'project.json';
  let rootProject: any = {};
  if (tree.exists(rootProjectJsonPath)) {
    rootProject = JSON.parse(tree.read(rootProjectJsonPath, 'utf-8')!);
  }
  rootProject.targets = rootProject.targets ?? {};
  rootProject.targets['license-check'] = {
    executor: '@aws/nx-plugin:license-check',
    cache: true,
    inputs: [
      ...LICENSE_CHECK_LOCKFILE_INPUTS,
      '{workspaceRoot}/aws-nx-plugin.config.mts',
    ],
    options: {},
  };
  tree.write(rootProjectJsonPath, JSON.stringify(rootProject, null, 2));

  // Adding a root project.json registers the workspace root as an Nx project.
  // Suppress target inference from the root package.json scripts (build, lint,
  // test, etc. are `nx run-many` wrappers) so they don't become targets — an
  // inferred `build` target would recurse when running `nx run-many --target build`.
  if (tree.exists('package.json')) {
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8')!);
    if (
      !packageJson.nx?.includedScripts ||
      packageJson.nx.includedScripts.length !== 0
    ) {
      packageJson.nx = { ...packageJson.nx, includedScripts: [] };
      tree.write('package.json', JSON.stringify(packageJson, null, 2));
    }
  }
};

const addExceptionsForExistingProjects = async (tree: Tree): Promise<void> => {
  const projects = getProjects(tree);
  let needsMcp = false;
  let needsAgUi = false;

  const mcpIds = [
    TS_MCP_SERVER_GENERATOR_INFO.id,
    PY_MCP_SERVER_GENERATOR_INFO.id,
  ];
  const pyAgentId = PY_AGENT_GENERATOR_INFO.id;

  for (const [, config] of projects) {
    const components =
      (config as any).metadata?.components ??
      (config as any).metadata?.generators ??
      [];
    for (const comp of components) {
      const gen = comp.generator ?? comp;
      if (typeof gen === 'string' && mcpIds.includes(gen)) {
        needsMcp = true;
      }
      if (typeof gen === 'string' && gen === pyAgentId) {
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
    await ensureLicenseExceptions(tree, exceptions);
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
