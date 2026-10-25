/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { basename } from 'node:path';
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator.js';
import { PY_MCP_SERVER_GENERATOR_INFO } from '../../../py/mcp-server/generator.js';
import {
  PYTHON_AGENT_CORE_LAUNCHER,
  pythonAgentCoreLauncher,
} from '../../../utils/agent-core-packaging.js';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { kebabCase } from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';

const TERRAFORM_RUNTIME =
  'packages/common/terraform/src/core/agent-core-code/runtime.tf';
const terraformEntry =
  'entry_point = var.code_entry_point == "agentcore_launcher.py" ? [var.code_entry_point] : ["opentelemetry-instrument", var.code_entry_point]';
const oldTerraformEntry =
  'entry_point = ["opentelemetry-instrument", var.code_entry_point]';
const hcl = (pattern: string) => `language hcl\n${pattern}`;
const terraformInput = (entryPoint: string) =>
  `\`module "agent_core_runtime" { $body }\` where { $body <: contains \`code_runtime = $runtime\`, $runtime <: r".*PYTHON_.*", $body <: contains \`code_entry_point = "${entryPoint}"\` }`;
const cdkInput = (entryPoint: string) =>
  `\`AgentRuntimeArtifact.fromCodeAsset({ $props })\` where { $props <: contains \`runtime: AgentCoreRuntime.$runtime\`, $runtime <: r"PYTHON_.*", $props <: contains \`entrypoint: ${entryPoint}\` }`;

/** Add the interpreter-safe launcher without changing the user's main.py or application. */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  for (const project of getProjects(tree).values()) {
    const components: ComponentMetadata[] = project.metadata?.components ?? [];
    let changed = false;
    for (const component of components) {
      const agent = component.generator === PY_AGENT_GENERATOR_INFO.id;
      if (
        (!agent && component.generator !== PY_MCP_SERVER_GENERATOR_INFO.id) ||
        component.infra !== 'agentcore'
      ) {
        continue;
      }
      const terraform = component.iac === 'terraform';
      const targetName = `${component.name}-package`;
      const target = project.targets?.[targetName];
      const name = kebabCase(component.rc ?? '');
      const packageDir = joinPathFragments(
        project.root,
        'package',
        basename(component.path ?? ''),
      );
      const outputDir = joinPathFragments(
        'dist',
        project.root,
        'package',
        name,
      );
      const launcherPath = joinPathFragments(
        packageDir,
        PYTHON_AGENT_CORE_LAUNCHER,
      );
      const launcher = pythonAgentCoreLauncher('main.py');
      const copyLauncher = `shx cp ${launcherPath} ${outputDir}/${PYTHON_AGENT_CORE_LAUNCHER}`;
      const commands = target?.options?.commands;
      const expectedCommands = [
        `shx rm -rf ${outputDir}`,
        `shx mkdir -p ${outputDir}`,
        `shx cp -R dist/${project.root}/bundle-arm/. ${outputDir}`,
        `shx cp -R ${project.sourceRoot}/. ${outputDir}/${basename(project.sourceRoot ?? '')}`,
        `shx cp ${packageDir}/main.py ${outputDir}/main.py`,
      ];
      const category = agent ? 'agents' : 'mcp-servers';
      const infraPath = terraform
        ? `packages/common/terraform/src/app/${category}/${name}/${name}.tf`
        : `packages/common/constructs/src/app/${category}/${name}/${name}.ts`;
      const report = () =>
        nextSteps.push(
          `${project.name}/${component.name}: review customized packaging or ${infraPath}; add ${PYTHON_AGENT_CORE_LAUNCHER} calling OpenTelemetry run() with sys.executable and main.py, copy it to the package root, and select it as this Python runtime's code entrypoint.`,
        );
      if (
        !component.path ||
        !component.rc ||
        !['cdk', 'terraform'].includes(component.iac) ||
        target?.executor !== 'nx:run-commands' ||
        target.options?.parallel !== false ||
        !Array.isArray(commands) ||
        ![5, 6].includes(commands.length) ||
        expectedCommands.some(
          (command, index) => commands[index] !== command,
        ) ||
        (commands.length === 6 && commands[5] !== copyLauncher) ||
        !tree.exists(`${packageDir}/main.py`) ||
        !tree.exists(infraPath) ||
        (tree.exists(launcherPath) &&
          tree.read(launcherPath, 'utf-8') !== launcher) ||
        (terraform && !tree.exists(TERRAFORM_RUNTIME))
      ) {
        report();
        continue;
      }
      const oldEntry = terraform
        ? hcl(terraformInput('main.py'))
        : cdkInput("['opentelemetry-instrument', 'main.py']");
      const newEntry = terraform
        ? hcl(terraformInput(PYTHON_AGENT_CORE_LAUNCHER))
        : cdkInput("['agentcore_launcher.py']");
      const alreadyMigrated = await matchGritQL(tree, infraPath, newEntry);
      const coreMigrated =
        terraform &&
        (await matchGritQL(
          tree,
          TERRAFORM_RUNTIME,
          hcl(`\`${terraformEntry}\``),
        ));
      if (
        (!alreadyMigrated && !(await matchGritQL(tree, infraPath, oldEntry))) ||
        (terraform &&
          !coreMigrated &&
          !(await matchGritQL(
            tree,
            TERRAFORM_RUNTIME,
            hcl(`\`${oldTerraformEntry}\``),
          )))
      ) {
        report();
        continue;
      }
      if (terraform && !coreMigrated) {
        await applyGritQL(
          tree,
          TERRAFORM_RUNTIME,
          hcl(`\`${oldTerraformEntry}\` => \`${terraformEntry}\``),
        );
      }
      if (!tree.exists(launcherPath)) tree.write(launcherPath, launcher);
      if (commands.length === 5) {
        commands.push(copyLauncher);
        changed = true;
      }
      if (!alreadyMigrated) {
        await applyGritQL(
          tree,
          infraPath,
          terraform
            ? hcl(
                '`module "agent_core_runtime" { $body }` where { $body <: contains `code_runtime = $runtime`, $runtime <: r".*PYTHON_.*", $body <: contains bubble `code_entry_point = "main.py"` => `code_entry_point = "agentcore_launcher.py"` }',
              )
            : "`AgentRuntimeArtifact.fromCodeAsset({ $props })` where { $props <: contains `runtime: AgentCoreRuntime.$runtime`, $runtime <: r\"PYTHON_.*\", $props <: contains bubble `entrypoint: ['opentelemetry-instrument', 'main.py']` => `entrypoint: ['agentcore_launcher.py']` }",
        );
      }
    }
    if (changed) updateProjectConfiguration(tree, project.name, project);
  }
  await formatFilesInSubtree(tree);
  return { nextSteps };
}
