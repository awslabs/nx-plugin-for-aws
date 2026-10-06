/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../utils/format.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { esmVars } from '../../utils/module-format.js';
import { toClassName } from '../../utils/names.js';
import { getNpmScope } from '../../utils/npm-scope.js';
import {
  addComponentGeneratorMetadata,
  type ComponentMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { sortObjectKeys } from '../../utils/object.js';
import { TS_AGENT_GENERATOR_INFO } from '../agent/generator.js';
import type { TsAgentEvalGeneratorSchema } from './schema';

export const TS_AGENT_EVAL_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Find the `ts#agent` component to evaluate, by name when given, otherwise the
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
        : `Project ${projectName} has more than one TypeScript Agent. Specify which to evaluate with --agent. Available agents: ${available}`,
    );
  }
  return agents[0];
};

export const tsAgentEvalGenerator = async (
  tree: Tree,
  options: TsAgentEvalGeneratorSchema,
): Promise<void> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);
  const agent = resolveAgent(
    project.name,
    (project.metadata as any)?.components ?? [],
    options.agent,
  );

  const agentTargetPrefix = agent.name ?? 'agent';
  const agentNameClassName = agent.rc ?? toClassName(agentTargetPrefix);
  const evalsDirRelativeToProjectRoot = joinPathFragments(
    'evals',
    agentTargetPrefix,
  );
  const casesFile = joinPathFragments(
    evalsDirRelativeToProjectRoot,
    'cases.json',
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'scripts'),
    joinPathFragments(project.root, 'scripts', agentTargetPrefix),
    {
      agentNameClassName,
      casesFile,
      relativeAgentImport: `../../${agent.path}`,
      agentConnectionImport: `@${getNpmScope(tree)}/agent-connection`,
      ...esmVars(tree),
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // The cases are the user's to edit, so a re-run never touches them.
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'evals'),
    joinPathFragments(project.root, evalsDirRelativeToProjectRoot),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  const evalTargetName = `${agentTargetPrefix}-eval`;
  if (!project.targets?.[evalTargetName]) {
    updateProjectConfiguration(tree, project.name, {
      ...project,
      targets: sortObjectKeys({
        ...project.targets,
        [evalTargetName]: {
          executor: 'nx:run-commands',
          options: {
            commands: [`tsx ./scripts/${agentTargetPrefix}/eval.ts`],
            cwd: '{projectRoot}',
            env: {
              LOCAL_DEV: 'true',
            },
          },
        },
      }),
    });
  }

  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_AGENT_EVAL_GENERATOR_INFO,
    evalsDirRelativeToProjectRoot,
    agentTargetPrefix,
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_AGENT_EVAL_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
};

export default tsAgentEvalGenerator;
