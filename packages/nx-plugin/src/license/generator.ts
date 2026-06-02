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
 * Write/update root project.json with license-check target
 */
const writeLicenseCheckTarget = (tree: Tree): void => {
  const lockfiles: string[] = [];
  if (tree.exists('pnpm-lock.yaml'))
    lockfiles.push('{workspaceRoot}/pnpm-lock.yaml');
  if (tree.exists('yarn.lock')) lockfiles.push('{workspaceRoot}/yarn.lock');
  if (tree.exists('package-lock.json'))
    lockfiles.push('{workspaceRoot}/package-lock.json');
  if (tree.exists('bun.lockb')) lockfiles.push('{workspaceRoot}/bun.lockb');
  if (tree.exists('uv.lock')) lockfiles.push('{workspaceRoot}/uv.lock');

  const rootProjectJsonPath = 'project.json';
  let rootProject: any = {};
  if (tree.exists(rootProjectJsonPath)) {
    rootProject = JSON.parse(tree.read(rootProjectJsonPath, 'utf-8')!);
  }
  rootProject.targets = rootProject.targets ?? {};
  rootProject.targets['license-check'] = {
    executor: '@aws/nx-plugin:license-check',
    cache: true,
    inputs: [...lockfiles, '{workspaceRoot}/aws-nx-plugin.config.mts'],
    options: {},
  };
  tree.write(rootProjectJsonPath, JSON.stringify(rootProject, null, 2));
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
