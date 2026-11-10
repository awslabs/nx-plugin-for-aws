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
import { addGuardrailPolicySynthInputs } from '../../../ts/agent/guardrails/synth-inputs.js';
import { getPythonAgentConnectionModuleName } from '../../../utils/agent-connection/agent-connection.js';
import {
  addPythonDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  addGuardrailInfra,
  addGuardrailPolicy,
} from '../../../utils/guardrail-constructs/guardrail-constructs.js';
import {
  guardrailWiringMessage,
  PY_AGENT_TERRAFORM_DEPLOY_GUIDE_URL,
} from '../../../utils/guardrail-constructs/guardrail-wiring.js';
import type { Iac } from '../../../utils/iac.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { kebabCase, toClassName } from '../../../utils/names.js';
import { getNpmScope } from '../../../utils/npm-scope.js';
import {
  addComponentGeneratorMetadata,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { PY_AGENT_GENERATOR_INFO } from '../generator.js';
import type { PyAgentFramework } from '../schema';
import type { PyAgentGuardrailsGeneratorSchema } from './schema';

export const PY_AGENT_GUARDRAILS_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Find the `py#agent` component to guard, by name when given, otherwise the
 * project's only one.
 */
const resolveAgent = (
  projectName: string,
  components: ComponentMetadata[],
  agent?: string,
): ComponentMetadata => {
  const agents = components.filter(
    (c) => c.generator === PY_AGENT_GENERATOR_INFO.id,
  );
  const available = agents.map((c) => c.name).join(', ') || 'none';
  if (agent) {
    const match = agents.find((c) => c.name === agent);
    if (!match) {
      throw new Error(
        `No Python Agent named ${agent} in project ${projectName}. Available agents: ${available}`,
      );
    }
    return match;
  }
  if (agents.length !== 1) {
    throw new Error(
      agents.length === 0
        ? `Project ${projectName} has no Python Agent. Add one with the py#agent generator first.`
        : `Project ${projectName} has more than one Python Agent. Specify which to guard with --agent. Available agents: ${available}`,
    );
  }
  return agents[0];
};

/**
 * The guardrail construct or module is keyed by the agent's class name, so a
 * TypeScript agent with the same class name already owns it. Refuse rather
 * than leave this agent unguarded behind the other agent's policy.
 */
const assertNoOtherAgentGuardrail = (
  tree: Tree,
  iac: Iac,
  nameClassName: string,
  nameKebabCase: string,
  policyPath: string,
): void => {
  const file =
    iac === 'cdk'
      ? joinPathFragments(
          PACKAGES_DIR,
          SHARED_CONSTRUCTS_DIR,
          'src',
          'app',
          'guardrails',
          nameKebabCase,
          `${nameKebabCase}-guardrail.ts`,
        )
      : joinPathFragments(
          PACKAGES_DIR,
          SHARED_TERRAFORM_DIR,
          'src',
          'app',
          'guardrails',
          nameKebabCase,
          `${nameKebabCase}-guardrail.tf`,
        );
  if (!tree.exists(file)) {
    return;
  }
  const contents = tree.read(file, 'utf-8');
  if (
    [`'${policyPath}'`, `"${policyPath}"`, `/${policyPath}"`].some((ref) =>
      contents.includes(ref),
    )
  ) {
    return;
  }
  throw new Error(
    `Guardrail infrastructure for ${nameClassName} already exists at ${file} for another agent's guardrail.json. Agents in different projects that share the class name ${nameClassName} share one runtime construct; give one of them a different name.`,
  );
};

/**
 * Add `model=get_guardrailed_model()` to the `Agent(...)` call in a Strands
 * agent.py. An agent that already sets its own model is left unchanged, and
 * the lines to add by hand are logged instead.
 */
const addGuardrailedModelToStrandsAgent = async (
  tree: Tree,
  agentFile: string,
): Promise<void> => {
  if (tree.exists(agentFile)) {
    if (
      await matchGritQL(
        tree,
        agentFile,
        'language python\n`get_guardrailed_model()`',
      )
    ) {
      return;
    }
    if (
      await applyGritQL(
        tree,
        agentFile,
        'language python\n`Agent($args)` => `Agent(model=get_guardrailed_model(), $args)` where { $args <: not contains `model=$_` }',
      )
    ) {
      await addPythonDestructuredImport(
        tree,
        agentFile,
        ['get_guardrailed_model'],
        '.guardrail',
      );
      return;
    }
  }

  logger.warn(
    `Could not add the guardrail to ${agentFile}, because ${tree.exists(agentFile) ? 'its Agent(...) call already sets a model or was not found' : 'the file does not exist'}. Set the model of your Agent to the guardrailed model by hand:

  model=get_guardrailed_model(),

and import it:

  from .guardrail import get_guardrailed_model`,
  );
};

/**
 * Replace the `ChatBedrockConverse(...)` call in a LangChain agent.py with the
 * guardrailed subclass, keeping its arguments. An agent that builds its model
 * another way is left unchanged, and the lines to add by hand are logged.
 */
const addGuardrailedModelToLangChainAgent = async (
  tree: Tree,
  agentFile: string,
): Promise<void> => {
  if (tree.exists(agentFile)) {
    if (
      await matchGritQL(
        tree,
        agentFile,
        'language python\n`GuardrailedChatBedrockConverse($_)`',
      )
    ) {
      return;
    }
    if (
      await applyGritQL(
        tree,
        agentFile,
        'language python\n`ChatBedrockConverse($args)` => `GuardrailedChatBedrockConverse($args)`',
      )
    ) {
      await addPythonDestructuredImport(
        tree,
        agentFile,
        ['GuardrailedChatBedrockConverse'],
        '.guardrail',
      );
      return;
    }
  }

  logger.warn(
    `Could not add the guardrail to ${agentFile}, because ${tree.exists(agentFile) ? 'it has no ChatBedrockConverse(...) call' : 'the file does not exist'}. Create your model with the guardrailed class by hand:

  model = GuardrailedChatBedrockConverse(model=MODEL_ID, region_name=REGION)

and import it:

  from .guardrail import GuardrailedChatBedrockConverse`,
  );
};

export const pyAgentGuardrailsGenerator = async (
  tree: Tree,
  options: PyAgentGuardrailsGeneratorSchema,
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
  const framework: PyAgentFramework = agent.framework ?? 'strands';
  const moduleName = (project.sourceRoot ?? project.root).split('/').pop();
  const agentPath = joinPathFragments(
    agent.path ?? joinPathFragments(moduleName, 'agent'),
  );
  const agentDir = joinPathFragments(project.root, agentPath);
  const policyPath = joinPathFragments(agentDir, 'guardrail.json');
  const iac = agent.iac as Iac | undefined;

  if (iac) {
    assertNoOtherAgentGuardrail(
      tree,
      iac,
      agentNameClassName,
      nameKebabCase,
      policyPath,
    );
  }

  // The policy and guardrail.py are the user's to edit, so a re-run never
  // touches them.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', framework),
    agentDir,
    {
      agentConnectionModuleName: getPythonAgentConnectionModuleName(tree),
      agentNameClassName,
      nameKebabCase,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  addGuardrailPolicy(tree, agentDir);

  const agentFile = joinPathFragments(agentDir, 'agent.py');
  if (framework === 'langchain') {
    await addGuardrailedModelToLangChainAgent(tree, agentFile);
  } else {
    await addGuardrailedModelToStrandsAgent(tree, agentFile);
  }

  let wiringMessage: string | undefined;
  if (iac) {
    await addGuardrailInfra(tree, {
      iac,
      nameClassName: agentNameClassName,
      nameKebabCase,
      policyPath,
    });
    if (iac === 'cdk') {
      for (const message of addGuardrailPolicySynthInputs(tree, [policyPath])) {
        logger.warn(message);
      }
    }
    wiringMessage = guardrailWiringMessage({
      iac,
      nameClassName: agentNameClassName,
      nameKebabCase,
      npmScope: getNpmScope(tree),
      deployGuideUrl: PY_AGENT_TERRAFORM_DEPLOY_GUIDE_URL,
    });
  } else {
    logger.warn(
      `Agent ${agentTargetPrefix} in project ${project.name} has no infrastructure, so no guardrail infrastructure was generated. Create the guardrail yourself and write its ID and version to runtime config at agentcore.guardrails.${agentNameClassName} as { guardrailId, guardrailVersion }.`,
    );
  }

  addComponentGeneratorMetadata(
    tree,
    project.name,
    PY_AGENT_GUARDRAILS_GENERATOR_INFO,
    agentPath,
    agentTargetPrefix,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_AGENT_GUARDRAILS_GENERATOR_INFO,
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

export default pyAgentGuardrailsGenerator;
