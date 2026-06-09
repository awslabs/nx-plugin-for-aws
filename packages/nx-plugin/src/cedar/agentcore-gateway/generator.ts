/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addAgentCoreGatewayInfra } from '../../utils/agent-core-constructs/agent-core-constructs';
import { formatFilesInSubtree } from '../../utils/format';
import { resolveIac } from '../../utils/iac';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import type { AgentcoreGatewayGeneratorSchema } from './schema';

export const AGENTCORE_GATEWAY_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const agentcoreGatewayGenerator = async (
  tree: Tree,
  options: AgentcoreGatewayGeneratorSchema,
): Promise<GeneratorCallback> => {
  const name = kebabCase(options.name);
  const nameClassName = toClassName(name);
  const parentDir = options.directory ?? 'packages';
  const subDir = options.subDirectory ?? name;
  const projectRoot = joinPathFragments(parentDir, subDir);
  const fullyQualifiedName = `${getNpmScopePrefix(tree)}${name}`;

  // Protocol / auth are fixed to mcp / iam in v1 — the enums accept only
  // these values, but we still persist the resolved value in metadata so
  // that connection generators can read it uniformly (and future additions
  // are non-breaking).
  const protocol = options.protocol ?? 'mcp';
  const auth = options.auth ?? 'iam';

  // Scaffold the gateway project: policies/ + README.md + project.json
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'project'),
    projectRoot,
    { nameClassName, nameKebabCase: name },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // `<name>-serve` and `<name>-serve-local` are aggregator targets that
  // chain onto attached MCP servers' (and other dependencies') own
  // long-running `serve` / `serve-local` targets. The aggregator does no
  // work of its own — it just groups deps so a single
  // `nx run <agent>:<agent>-serve-local` boots every attached MCP server
  // alongside the agent.
  //
  // It must be a `continuous` keep-alive process rather than `nx:noop`:
  // when this aggregator is itself a dependency of an agent's continuous
  // `serve-local`, a non-continuous task would be considered "done" and Nx
  // would tear down its continuous MCP-server dependencies. Staying alive
  // keeps them running for the lifetime of the agent.
  //
  // `serve` exists for parity with other generators (every project has both
  // `serve` and `serve-local`); the Gateway itself is a managed AWS
  // resource, so its `serve` has no `SERVE_LOCAL=true`. Connection
  // generators wire agent-side `<agent>-serve` to this target so a
  // `serve`-mode agent talks to the deployed Gateway via runtime config.
  const keepAliveAggregator = () => ({
    executor: 'nx:run-commands' as const,
    continuous: true,
    options: {
      // Idle keep-alive: the aggregator owns no server of its own, it only
      // holds its continuous MCP-server dependencies open.
      commands: ['node -e "setInterval(() => {}, 1 << 30)"'],
    },
    dependsOn: [] as Array<string | { projects: string[]; target: string }>,
  });
  if (projectExists(tree, fullyQualifiedName)) {
    // Re-run: keep the existing targets (their dependsOn may have been
    // populated by the mcp-connection generator), just ensure both
    // aggregators exist.
    const config = readProjectConfigurationUnqualified(
      tree,
      fullyQualifiedName,
    );
    config.targets ??= {};
    config.targets[`${name}-serve`] ??= keepAliveAggregator();
    config.targets[`${name}-serve-local`] ??= keepAliveAggregator();
    updateProjectConfiguration(tree, config.name, config);
  } else {
    addProjectConfiguration(tree, fullyQualifiedName, {
      name: fullyQualifiedName,
      root: projectRoot,
      projectType: 'library',
      sourceRoot: projectRoot,
      tags: [],
      targets: {
        [`${name}-serve`]: keepAliveAggregator(),
        [`${name}-serve-local`]: keepAliveAggregator(),
      },
      metadata: {
        generator: AGENTCORE_GATEWAY_GENERATOR_INFO.id,
      } as any,
    });
  }

  addComponentGeneratorMetadata(
    tree,
    fullyQualifiedName,
    AGENTCORE_GATEWAY_GENERATOR_INFO,
    '.',
    name,
    { rc: nameClassName, protocol, auth },
  );

  // Wire up infra (CDK or Terraform)
  const iac = await resolveIac(tree, options.iac);
  await sharedConstructsGenerator(tree, { iac });

  await addAgentCoreGatewayInfra(tree, {
    gatewayNameClassName: nameClassName,
    gatewayNameKebabCase: name,
    projectName: fullyQualifiedName,
    projectDirectory: projectRoot,
    iac,
  });

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default agentcoreGatewayGenerator;
