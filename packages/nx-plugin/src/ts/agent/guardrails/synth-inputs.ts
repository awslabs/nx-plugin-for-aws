/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';

/** The Nx fileset input for a workspace-root-relative guardrail.json. */
export const guardrailPolicyInput = (policyPath: string): string =>
  `{workspaceRoot}/${policyPath}`;

/**
 * Add each guardrail.json to the `synth` inputs of every CDK infrastructure
 * project. The CDK guardrail construct reads the file at synth time, but it
 * belongs to the agent's project and no upstream task output includes it, so
 * without an explicit input a policy change is served from the Nx cache.
 *
 * Existing inputs are kept and entries already present are not repeated. A
 * project without a `synth` target, or whose `synth` has no `inputs` array, is
 * left unchanged, since adding an array would replace Nx's implicit inputs;
 * one message per such project is returned instead.
 */
export const addGuardrailPolicySynthInputs = (
  tree: Tree,
  policyPaths: string[],
): string[] => {
  const entries = [...new Set(policyPaths)].map(guardrailPolicyInput);
  const messages: string[] = [];
  if (entries.length === 0) {
    return messages;
  }

  for (const [name, project] of getProjects(tree)) {
    if (project.metadata?.generator !== INFRA_APP_GENERATOR_INFO.id) {
      continue;
    }
    const projectJson = joinPathFragments(project.root, 'project.json');
    const synth = project.targets?.synth;
    if (!synth || !Array.isArray(synth.inputs)) {
      const problem = synth
        ? `the synth target in ${projectJson} has no inputs`
        : `${projectJson} has no synth target`;
      messages.push(
        `${name}: ${problem} - left unchanged. Add ${entries.join(', ')} to its synth inputs so a change to the guardrail policy invalidates the cached synth.`,
      );
      continue;
    }
    const missing = entries.filter((entry) => !synth.inputs.includes(entry));
    if (missing.length > 0) {
      updateJson(tree, projectJson, (config) => {
        config.targets.synth.inputs = [
          ...config.targets.synth.inputs,
          ...missing,
        ];
        return config;
      });
    }
  }

  return messages;
};
