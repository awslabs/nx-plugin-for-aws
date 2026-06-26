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
  addDevAlias,
  addGeneratorMetadata,
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
  const infra = options.infra ?? 'agentcore';

  // serve-local.ts is the local gateway: a continuous MCP aggregator chaining
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
      command: 'tsx serve-local.ts',
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
  const port = assignPort(tree, project, 8100);
  // Re-run: keep existing targets (their dependsOn may have been populated
  // by the mcp-connection generator), just ensure both exist.
  project.targets ??= {};
  project.targets[`${name}-serve`] ??= localGatewayTarget(port);
  project.targets[`${name}-serve-local`] ??= localGatewayTarget(port);
  // `<gateway>-dev` aliases `<gateway>-serve-local`; the first component in a
  // project also gets a project-level `dev` aliasing it.
  addDevAlias(project.targets, `${name}-serve-local`, {
    devTargetName: `${name}-dev`,
    aliasAsProjectDev: true,
  });
  updateProjectConfiguration(tree, project.name, project);

  // Scaffold the gateway project: serve-local.ts (+ Cedar policies if requested)
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

  addGeneratorMetadata(
    tree,
    fullyQualifiedName,
    AGENTCORE_GATEWAY_GENERATOR_INFO,
    {
      name,
      rc: nameClassName,
      protocol,
      auth,
      port,
    },
  );

  // serve-local.ts dependencies (+ ejs for Cedar policy rendering in the
  // shared gateway construct)
  addDependenciesToPackageJson(
    tree,
    withVersions(['@modelcontextprotocol/sdk', 'express']),
    withVersions(['tsx', '@types/express', 'ejs', '@types/ejs']),
  );

  // Wire up infra (CDK or Terraform); re-running with infra=agentcore adds
  // the infrastructure to a previously infra-less gateway.
  if (infra === 'agentcore') {
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
  }

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_GATEWAY_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

/**
 * Gateway details stored in the gateway project's metadata.
 */
export interface AgentCoreGatewayMetadata {
  name: string;
  rc: string;
  protocol: string;
  auth: string;
  port: number;
}

/**
 * Read a gateway project's metadata, validating it was generated by the
 * agentcore-gateway generator.
 */
export const readAgentCoreGatewayMetadata = (
  project: ProjectConfiguration,
): AgentCoreGatewayMetadata => {
  const metadata = project.metadata as any;
  if (metadata?.generator !== AGENTCORE_GATEWAY_GENERATOR_INFO.id) {
    throw new Error(
      `Project '${project.name}' was not generated by the '${AGENTCORE_GATEWAY_GENERATOR_INFO.id}' generator.`,
    );
  }
  return metadata as AgentCoreGatewayMetadata;
};

export default agentcoreGatewayGenerator;
