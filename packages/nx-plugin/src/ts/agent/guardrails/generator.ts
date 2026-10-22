/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import {
  addDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { addGuardrailInfra } from '../../../utils/guardrail-constructs/guardrail-constructs.js';
import { guardrailWiringMessage } from '../../../utils/guardrail-constructs/guardrail-wiring.js';
import type { Iac } from '../../../utils/iac.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { esmVars, isEsmWorkspace } from '../../../utils/module-format.js';
import { kebabCase, toClassName } from '../../../utils/names.js';
import { getNpmScope } from '../../../utils/npm-scope.js';
import {
  addComponentGeneratorMetadata,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { TS_AGENT_GENERATOR_INFO } from '../generator.js';
import type { TsAgentGuardrailsGeneratorSchema } from './schema';

export const TS_AGENT_GUARDRAILS_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Find the `ts#agent` component to guard, by name when given, otherwise the
 * project's only one.
 */
const resolveAgent = (
  projectName: string,
  components: ComponentMetadata[],
  agent?: string,
): ComponentMetadata => {
  const agents = components.filter(
    (c) => c.generator === TS_AGENT_GENERATOR_INFO.id,
  );
  const available = agents.map((c) => c.name).join(', ') || 'none';
  if (agent) {
    const match = agents.find((c) => c.name === agent);
    if (!match) {
      throw new Error(
        `No TypeScript Agent named ${agent} in project ${projectName}. Available agents: ${available}`,
      );
    }
    return match;
  }
  if (agents.length !== 1) {
    throw new Error(
      agents.length === 0
        ? `Project ${projectName} has no TypeScript Agent. Add one with the ts#agent generator first.`
        : `Project ${projectName} has more than one TypeScript Agent. Specify which to guard with --agent. Available agents: ${available}`,
    );
  }
  return agents[0];
};

/**
 * Add `model: getGuardrailedModel()` to the `new Agent({...})` call in
 * agent.ts. An agent that already sets its own model is left unchanged, and
 * the lines to add by hand are logged instead.
 */
const addGuardrailedModelToAgent = async (
  tree: Tree,
  agentFile: string,
): Promise<void> => {
  const guardrailImport = isEsmWorkspace(tree)
    ? './guardrail.js'
    : './guardrail';

  if (tree.exists(agentFile)) {
    if (await matchGritQL(tree, agentFile, '`getGuardrailedModel()`')) {
      return;
    }
    if (
      await applyGritQL(
        tree,
        agentFile,
        '`new Agent({ $props })` => `new Agent({ model: getGuardrailedModel(), $props })` where { $props <: not some or { `model: $_`, `model` } }',
      )
    ) {
      await addDestructuredImport(
        tree,
        agentFile,
        ['getGuardrailedModel'],
        './guardrail.js',
      );
      return;
    }
  }

  logger.warn(
    `Could not add the guardrail to ${agentFile}, because ${tree.exists(agentFile) ? 'its new Agent({...}) call already sets a model or is not an inline object' : 'the file does not exist'}. Set the model of your Agent to the guardrailed model by hand:

  model: getGuardrailedModel(),

and import it:

  import { getGuardrailedModel } from '${guardrailImport}';`,
  );
};

export const tsAgentGuardrailsGenerator = async (
  tree: Tree,
  options: TsAgentGuardrailsGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);
  const agent = resolveAgent(
    project.name,
    (project.metadata as any)?.components ?? [],
    options.agent,
  );

  const agentTargetPrefix = agent.name ?? 'agent';
  const agentNameClassName = agent.rc ?? toClassName(agentTargetPrefix);
  const nameKebabCase = kebabCase(agentNameClassName);
  const agentPath = agent.path ?? joinPathFragments('src', agentTargetPrefix);
  const agentDir = joinPathFragments(project.root, agentPath);

  // The policy is the user's to edit, so a re-run never touches these files.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'agent'),
    agentDir,
    {
      ...esmVars(tree),
      agentConnectionImport: `@${getNpmScope(tree)}/agent-connection`,
      agentNameClassName,
      nameKebabCase,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await addGuardrailedModelToAgent(
    tree,
    joinPathFragments(agentDir, 'agent.ts'),
  );

  const iac = agent.iac as Iac | undefined;
  let wiringMessage: string | undefined;
  if (iac) {
    await addGuardrailInfra(tree, {
      iac,
      nameClassName: agentNameClassName,
      nameKebabCase,
      policyPath: joinPathFragments(agentDir, 'guardrail.json'),
    });
    wiringMessage = guardrailWiringMessage({
      iac,
      nameClassName: agentNameClassName,
      nameKebabCase,
      npmScope: getNpmScope(tree),
    });
  } else {
    logger.warn(
      `Agent ${agentTargetPrefix} in project ${project.name} has no infrastructure, so no guardrail infrastructure was generated. Create the guardrail yourself and write its ID and version to runtime config at agentcore.guardrails.${agentNameClassName} as { guardrailId, guardrailVersion }.`,
    );
  }

  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_AGENT_GUARDRAILS_GENERATOR_INFO,
    agentPath,
    agentTargetPrefix,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_GUARDRAILS_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  // Printed from the callback so it appears after Nx lists the changed
  // files, on every run, since the generator cannot tell whether the stack is
  // already wired.
  return () => {
    if (wiringMessage) {
      logger.info(wiringMessage);
    }
  };
};

export default tsAgentGuardrailsGenerator;
