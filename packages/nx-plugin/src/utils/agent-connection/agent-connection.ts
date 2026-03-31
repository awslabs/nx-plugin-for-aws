/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import tsProjectGenerator from '../../ts/lib/generator';
import pyProjectGenerator, {
  getPyProjectDetails,
} from '../../py/project/generator';
import { addDependenciesToPyProjectToml } from '../py';
import { applyGritQL, matchGritQL } from '../ast';

/** Prefix a GritQL pattern with `language python` */
const py = (pattern: string) => `language python\n${pattern}`;

const AGENT_CONNECTION_DIR = 'agent-connection';
const PACKAGES_DIR = 'packages';
const COMMON_DIR = 'common';

export const AGENT_CONNECTION_PROJECT_DIR = joinPathFragments(
  PACKAGES_DIR,
  COMMON_DIR,
  AGENT_CONNECTION_DIR,
);

const PY_AGENT_CONNECTION_NAME = 'agent_connection';

/**
 * Get the directory of the shared Python agent-connection project.
 */
export function getPythonAgentConnectionProjectDir(tree: Tree): string {
  const { dir } = getPyProjectDetails(tree, {
    name: PY_AGENT_CONNECTION_NAME,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });
  return dir;
}

/**
 * Get the Python module name of the shared agent-connection project.
 */
export function getPythonAgentConnectionModuleName(tree: Tree): string {
  const { normalizedModuleName } = getPyProjectDetails(tree, {
    name: PY_AGENT_CONNECTION_NAME,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });
  return normalizedModuleName;
}

/**
 * Get the fully qualified Python package name of the shared agent-connection project.
 */
export function getPythonAgentConnectionPackageName(tree: Tree): string {
  const { fullyQualifiedName } = getPyProjectDetails(tree, {
    name: PY_AGENT_CONNECTION_NAME,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });
  return fullyQualifiedName;
}

/**
 * Ensure the shared TypeScript agent-connection project exists.
 * Creates the project with the core AgentCoreMcpClient if it doesn't exist.
 */
export async function ensureTypeScriptAgentConnectionProject(
  tree: Tree,
): Promise<void> {
  const projectJsonPath = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'project.json',
  );
  if (tree.exists(projectJsonPath)) {
    return; // Already exists
  }

  // Create the TS project
  await tsProjectGenerator(tree, {
    name: AGENT_CONNECTION_DIR,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });

  // Generate the core files (agentcore-mcp-client.ts)
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'core'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'core'),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
}

/**
 * Ensure the shared Python agent-connection project exists.
 * Creates the project with the core AgentCoreMCPClient if it doesn't exist.
 */
export async function ensurePythonAgentConnectionProject(
  tree: Tree,
): Promise<void> {
  const projectDir = getPythonAgentConnectionProjectDir(tree);
  const moduleName = getPythonAgentConnectionModuleName(tree);
  const projectJsonPath = joinPathFragments(projectDir, 'project.json');

  if (tree.exists(projectJsonPath)) {
    return; // Already exists
  }

  // Create the Python project using the standard py#project generator
  await pyProjectGenerator(tree, {
    name: PY_AGENT_CONNECTION_NAME,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
    projectType: 'library',
  });

  // Add dependencies needed by the core agentcore_mcp_client
  addDependenciesToPyProjectToml(tree, projectDir, [
    'boto3',
    'mcp',
    'strands-agents',
  ]);

  const moduleDir = joinPathFragments(projectDir, moduleName);

  // Generate the core files (agentcore_mcp_client.py)
  const coreDir = joinPathFragments(moduleDir, 'core');
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'py-core'),
    coreDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Ensure core/__init__.py exists
  if (!tree.exists(joinPathFragments(coreDir, '__init__.py'))) {
    tree.write(joinPathFragments(coreDir, '__init__.py'), '');
  }

  // Ensure app/__init__.py exists
  const appInitPath = joinPathFragments(moduleDir, 'app', '__init__.py');
  if (!tree.exists(appInitPath)) {
    tree.write(appInitPath, '');
  }
}

/**
 * Add a re-export to the Python agent-connection module's __init__.py.
 * Equivalent to addStarExport for TS.
 * Uses `__all__` to mark re-exports as public (satisfies ruff F401).
 * Uses GritQL for AST-aware transforms where possible.
 */
export async function addPythonReExport(
  tree: Tree,
  initFilePath: string,
  fromModule: string,
  importName: string,
): Promise<void> {
  // Check if already exported
  if (await matchGritQL(tree, initFilePath, `\`${importName}\``)) {
    return;
  }

  const importLine = `from ${fromModule} import ${importName}`;
  const allEntry = `"${importName}"`;

  // Try to append import after existing import using +=
  const appendedImport = await applyGritQL(
    tree,
    initFilePath,
    py(
      `\`from $mod import $name\` as $stmt where {
  $program <: not contains \`${importName}\`,
  $stmt += \`\n${importLine}\`
}`,
    ),
  );

  if (appendedImport) {
    // Also append to existing __all__
    await applyGritQL(
      tree,
      initFilePath,
      py(`\`__all__ = [$items]\` where { $items += \`, ${allEntry}\` }`),
    );
    return;
  }

  // No existing imports — first re-export. Try to anchor after docstring.
  const anchoredImport = await applyGritQL(
    tree,
    initFilePath,
    py(
      `\`"""Automatically generated by Nx."""\` as $doc => \`$doc\n${importLine}\n\n__all__ = [${allEntry}]\``,
    ),
  );

  if (!anchoredImport) {
    // Completely empty file or no docstring — write directly
    tree.write(initFilePath, `${importLine}\n\n__all__ = [${allEntry}]\n`);
  }
}
