/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, readNxJson, type Tree, updateNxJson } from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../py/agent/generator';
import { PY_MCP_SERVER_GENERATOR_INFO } from '../py/mcp-server/generator';
import { TS_MCP_SERVER_GENERATOR_INFO } from '../ts/mcp-server/generator';
import { ensureAwsNxPluginConfig } from '../utils/config/utils';
import { formatFilesInSubtree } from '../utils/format';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import {
  getGeneratorInfo,
  type NxGeneratorInfo,
  readTargetDefaultToMerge,
} from '../utils/nx';
import {
  addLicenseCheckToAllLintTargets,
  defaultLicenseConfig,
  ensureDependencyCheckBlock,
  ensureLicenseExceptions,
  ensurePythonLicenseCollector,
  updateLicenseCheckTargetInputs,
  writeLicenseConfig,
} from './config';
import {
  AG_UI_LANGGRAPH_EXCEPTIONS,
  MCP_INSPECTOR_EXCEPTIONS,
} from './known-exceptions';
import type { LicenseGeneratorSchema } from './schema';
import { SYNC_GENERATOR_NAME } from './sync/generator';

export const LICENSE_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

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
    await writeLicenseCheckTarget(tree);
    // Make every existing project's lint target depend on the root
    // license-check target, so the check runs as part of lint/build regardless
    // of whether projects were created before or after the license generator.
    addLicenseCheckToAllLintTargets(tree);
  }

  const nxJson = readNxJson(tree);
  const lintDefault = readTargetDefaultToMerge(nxJson.targetDefaults, 'lint');
  const lintTargetDefault = {
    ...lintDefault,
    syncGenerators: [
      ...(lintDefault.syncGenerators ?? []).filter(
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

  await formatFilesInSubtree(tree);
}

/**
 * Write/update root project.json with the license-check target.
 */
const writeLicenseCheckTarget = async (tree: Tree): Promise<void> => {
  const rootProjectJsonPath = 'project.json';
  let rootProject: any = {};
  if (tree.exists(rootProjectJsonPath)) {
    rootProject = JSON.parse(tree.read(rootProjectJsonPath, 'utf-8')!);
  }
  rootProject.targets = rootProject.targets ?? {};
  rootProject.targets['license-check'] = {
    executor: '@aws/nx-plugin:license-check',
    cache: true,
    inputs: [],
    options: {},
  };
  tree.write(rootProjectJsonPath, JSON.stringify(rootProject, null, 2));

  // Populate `inputs` from the lockfiles actually present (+ uv.lock if a
  // Python collector is configured) and the config file.
  await updateLicenseCheckTargetInputs(tree);

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
  // A LangChain AG-UI agent pulls jsonpatch/jsonpointer (BSD-3-Clause but with
  // only free-text metadata) via langchain-core. The py#agent generator adds
  // these exceptions itself, but if the license generator runs afterwards (or
  // the agent predates the dependency-check block) they may be missing, so
  // re-assert them here when such an agent exists.
  let needsLangchain = false;

  const mcpIds = [
    TS_MCP_SERVER_GENERATOR_INFO.id,
    PY_MCP_SERVER_GENERATOR_INFO.id,
  ];

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
      if (
        gen === PY_AGENT_GENERATOR_INFO.id &&
        comp.framework === 'langchain'
      ) {
        needsLangchain = true;
      }
    }
  }

  const exceptions = [
    ...(needsMcp ? MCP_INSPECTOR_EXCEPTIONS : []),
    ...(needsLangchain ? AG_UI_LANGGRAPH_EXCEPTIONS : []),
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
