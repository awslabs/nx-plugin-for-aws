/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  addProjectConfiguration,
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addAgentCoreGatewayInfra } from '../utils/agent-core-constructs/agent-core-constructs';
import { formatFilesInSubtree } from '../utils/format';
import { resolveIac } from '../utils/iac';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import { kebabCase, toClassName } from '../utils/names';
import { getNpmScopePrefix } from '../utils/npm-scope';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
  readProjectConfigurationUnqualified,
} from '../utils/nx';
import { assignPort } from '../utils/port';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { withVersions } from '../utils/versions';
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
  const cedarPolicy = options.cedarPolicy ?? true;

  // serve.ts is the local gateway: a continuous MCP aggregator chaining
  // onto attached MCP servers' serve-local targets (added by the
  // mcp-connection generator), so a single `nx run <agent>:<agent>-serve-local`
  // boots the gateway and every attached MCP server together.
  //
  // `serve` exists for parity with other generators; the deployed Gateway is
  // a managed AWS resource, so `serve`-mode agents talk to it via runtime
  // config and the local gateway sits idle.
  const localGatewayTarget = (port: number) => ({
    executor: 'nx:run-commands' as const,
    continuous: true,
    options: {
      command: 'tsx serve.ts',
      cwd: '{projectRoot}',
      env: { PORT: `${port}` },
    },
    dependsOn: [] as Array<string | { projects: string[]; target: string }>,
  });
  let project: ProjectConfiguration;
  if (projectExists(tree, fullyQualifiedName)) {
    project = readProjectConfigurationUnqualified(tree, fullyQualifiedName);
  } else {
    addProjectConfiguration(tree, fullyQualifiedName, {
      name: fullyQualifiedName,
      root: projectRoot,
      projectType: 'library',
      sourceRoot: projectRoot,
      tags: [],
      targets: {},
      metadata: {
        generator: AGENTCORE_GATEWAY_GENERATOR_INFO.id,
      } as any,
    });
    project = readProjectConfigurationUnqualified(tree, fullyQualifiedName);
  }
  const port = assignPort(tree, project, 8100, {
    component: { info: AGENTCORE_GATEWAY_GENERATOR_INFO, name },
  });
  // Re-run: keep existing targets (their dependsOn may have been populated
  // by the mcp-connection generator), just ensure both exist.
  project.targets ??= {};
  project.targets[`${name}-serve`] ??= localGatewayTarget(port);
  project.targets[`${name}-serve-local`] ??= localGatewayTarget(port);
  updateProjectConfiguration(tree, project.name, project);

  // Scaffold the gateway project: serve.ts (+ Cedar policies if requested)
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'project'),
    projectRoot,
    { nameClassName, nameKebabCase: name, port, attachedMcpServers: [] },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  if (cedarPolicy) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'cedar'),
      projectRoot,
      { nameClassName },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }

  addComponentGeneratorMetadata(
    tree,
    fullyQualifiedName,
    AGENTCORE_GATEWAY_GENERATOR_INFO,
    '.',
    name,
    { rc: nameClassName, protocol, auth, port },
  );

  // serve.ts dependencies (+ ejs for Cedar policy rendering in the construct)
  addDependenciesToPackageJson(
    tree,
    withVersions(['@modelcontextprotocol/sdk', 'express']),
    withVersions([
      'tsx',
      '@types/express',
      ...(cedarPolicy ? (['ejs', '@types/ejs'] as const) : []),
    ]),
  );

  // Wire up infra (CDK or Terraform)
  const iac = await resolveIac(tree, options.iac);
  await sharedConstructsGenerator(tree, { iac });

  await addAgentCoreGatewayInfra(tree, {
    gatewayNameClassName: nameClassName,
    gatewayNameKebabCase: name,
    projectName: fullyQualifiedName,
    projectDirectory: projectRoot,
    cedarPolicy,
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
