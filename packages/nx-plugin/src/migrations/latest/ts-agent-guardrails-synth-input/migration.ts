/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator.js';
import { TS_AGENT_GUARDRAILS_GENERATOR_INFO } from '../../../ts/agent/guardrails/generator.js';
import { addGuardrailPolicySynthInputs } from '../../../ts/agent/guardrails/synth-inputs.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import type { ComponentMetadata } from '../../../utils/nx.js';

/**
 * Add each CDK-guarded TypeScript agent's guardrail.json to the `synth` inputs
 * of the CDK infrastructure projects.
 *
 * The CDK guardrail construct reads guardrail.json at synth time to build the
 * guardrail's rules and version description. The file belongs to the agent's
 * project and no task output the infrastructure's `synth` hashes includes it,
 * so without an explicit input a policy change is served from the Nx cache
 * and `deploy-ci` ships the stale template.
 *
 * Guarded agents are found from the `ts#agent#guardrails` components in
 * project metadata, each paired with the `ts#agent` component of the same
 * name, and kept when that agent's IaC is CDK. An infrastructure project
 * whose `synth` has no `inputs` array, or no `synth` target, is left
 * unchanged and reported via `nextSteps`.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const policyPaths: string[] = [];
  for (const project of getProjects(tree).values()) {
    const components: ComponentMetadata[] =
      (project.metadata as { components?: ComponentMetadata[] } | undefined)
        ?.components ?? [];
    for (const guardrail of components.filter(
      (c) => c.generator === TS_AGENT_GUARDRAILS_GENERATOR_INFO.id,
    )) {
      const agent = components.find(
        (c) =>
          c.generator === TS_AGENT_GENERATOR_INFO.id &&
          (c.name ?? 'agent') === guardrail.name,
      );
      if (agent?.iac === 'cdk') {
        policyPaths.push(
          joinPathFragments(project.root, guardrail.path, 'guardrail.json'),
        );
      }
    }
  }

  const nextSteps = addGuardrailPolicySynthInputs(tree, policyPaths);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
