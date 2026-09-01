/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CORE_DIR = 'packages/common/terraform/src/core';
const LEGACY_MODULE = `${CORE_DIR}/agent-core/runtime.tf`;
const CONTAINER_MODULE = `${CORE_DIR}/agent-core-container/runtime.tf`;
const AGENT_MODULE =
  'packages/common/terraform/src/app/agents/my-agent/my-agent.tf';
const MCP_MODULE =
  'packages/common/terraform/src/app/mcp-servers/my-mcp-server/my-mcp-server.tf';

/**
 * The vended runtime module as an upgrading workspace has it: one module holding
 * both the runtime and its ECR plumbing.
 */
const legacyRuntimeModule = `terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.61.0"
    }
  }
}

variable "agent_runtime_name" {
  type = string
}

variable "docker_image_tag" {
  description = "Name of the docker image tag to use as the agent core runtime"
  type        = string
}

resource "random_id" "unique_suffix" {
  byte_length = 4
}

resource "aws_ecr_repository" "agent_core_repository" {
  name = "\${lower(var.agent_runtime_name)}_repository_\${random_id.unique_suffix.hex}"
}

resource "aws_iam_role" "agent_core_runtime_role" {
  name = "\${var.agent_runtime_name}-AgentCoreRuntimeRole-\${random_id.unique_suffix.hex}"
}

resource "aws_bedrockagentcore_agent_runtime" "agent_runtime" {
  agent_runtime_name = "\${var.agent_runtime_name}_\${random_id.unique_suffix.hex}"

  agent_runtime_artifact {
    container_configuration {
      container_uri = "\${aws_ecr_repository.agent_core_repository.repository_url}:latest"
    }
  }
}

output "agent_core_runtime_arn" {
  value = aws_bedrockagentcore_agent_runtime.agent_runtime.agent_runtime_arn
}
`;

const appModule = (name: string) => `module "agent_core_runtime" {
  source = "../../../core/agent-core"
  agent_runtime_name = "${name}"
  docker_image_tag = "scope-${name}:latest"
  server_protocol = "HTTP"
}

output "agent_core_runtime_arn" {
  value = module.agent_core_runtime.agent_core_runtime_arn
}
`;

describe('terraform agent core composed modules migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  it('should be a no-op for a workspace with no vended AgentCore terraform', async () => {
    const result = await migration(tree);

    expect(result).toEqual({});
    expect(tree.exists(CONTAINER_MODULE)).toBeFalsy();
  });

  it('should split the runtime module and keep the packaging as container', async () => {
    tree.write(LEGACY_MODULE, legacyRuntimeModule);
    tree.write(AGENT_MODULE, appModule('my-agent'));

    await migration(tree);

    // The generic module holds the runtime and no packaging plumbing.
    const core = tree.read(LEGACY_MODULE, 'utf-8');
    expect(core).toContain('aws_bedrockagentcore_agent_runtime');
    expect(core).not.toContain('aws_ecr_repository');
    expect(core).not.toContain('docker_image_tag');

    // The container wrapper owns the ECR plumbing and delegates the runtime.
    const container = tree.read(CONTAINER_MODULE, 'utf-8');
    expect(container).toContain('aws_ecr_repository');
    expect(container).toContain('null_resource" "docker_publish');
    expect(container).toContain('source = "../agent-core"');
    expect(container).toContain('container_configuration = {');

    // Code packaging is not introduced: an existing runtime stays on container.
    expect(tree.exists(`${CORE_DIR}/agent-core-code/runtime.tf`)).toBeFalsy();
    expect(container).not.toContain('code_configuration = {');
  });

  it('should carry state across so a deployed runtime is not replaced', async () => {
    tree.write(LEGACY_MODULE, legacyRuntimeModule);

    await migration(tree);

    const container = tree.read(CONTAINER_MODULE, 'utf-8');
    // Every resource that moves into the shared module needs a moved block, or
    // terraform would destroy and recreate the deployed runtime.
    for (const address of [
      'random_id.unique_suffix',
      'aws_iam_role.agent_core_runtime_role',
      'aws_iam_policy.agent_core_runtime_policy',
      'aws_iam_role_policy_attachment.agent_core_policy',
      'aws_security_group.agent_core_runtime',
      'aws_vpc_security_group_egress_rule.agent_core_runtime_https',
      'aws_bedrockagentcore_agent_runtime.agent_runtime',
      'null_resource.runtime_ready',
    ]) {
      expect(container).toContain(`from = ${address}`);
      expect(container).toContain(`to   = module.runtime.${address}`);
    }
  });

  it('should repoint every app module at the container wrapper', async () => {
    tree.write(LEGACY_MODULE, legacyRuntimeModule);
    tree.write(AGENT_MODULE, appModule('my-agent'));
    tree.write(MCP_MODULE, appModule('my-mcp-server'));

    const result = await migration(tree);

    for (const modulePath of [AGENT_MODULE, MCP_MODULE]) {
      const module = tree.read(modulePath, 'utf-8');
      expect(module).toContain('source = "../../../core/agent-core-container"');
      expect(module).not.toContain('source = "../../../core/agent-core"');
      // The image tag input is untouched, so the deployment stays as it was.
      expect(module).toContain('docker_image_tag');
    }

    expect(result.nextSteps?.[0]).toContain('2 vended AgentCore app modules');
    expect(result.nextSteps?.[0]).toContain('terraform plan');
  });

  it('should leave a diverged module untouched and report it', async () => {
    // No ECR repository, so this is not the generated shape.
    tree.write(
      LEGACY_MODULE,
      `resource "aws_bedrockagentcore_agent_runtime" "agent_runtime" {
  agent_runtime_name = "hand-written"
}
`,
    );
    tree.write(AGENT_MODULE, appModule('my-agent'));

    const result = await migration(tree);

    expect(tree.read(LEGACY_MODULE, 'utf-8')).toContain('hand-written');
    expect(tree.exists(CONTAINER_MODULE)).toBeFalsy();
    // The app module still points at the module it was written against.
    expect(tree.read(AGENT_MODULE, 'utf-8')).toContain(
      'source = "../../../core/agent-core"',
    );
    expect(result.nextSteps?.[0]).toContain('diverged');
  });

  it('should be idempotent', async () => {
    tree.write(LEGACY_MODULE, legacyRuntimeModule);
    tree.write(AGENT_MODULE, appModule('my-agent'));

    await migration(tree);
    const afterFirst = {
      core: tree.read(LEGACY_MODULE, 'utf-8'),
      container: tree.read(CONTAINER_MODULE, 'utf-8'),
      app: tree.read(AGENT_MODULE, 'utf-8'),
    };

    const secondResult = await migration(tree);

    // The second run recognises the split modules and does nothing.
    expect(secondResult).toEqual({});
    expect(tree.read(LEGACY_MODULE, 'utf-8')).toEqual(afterFirst.core);
    expect(tree.read(CONTAINER_MODULE, 'utf-8')).toEqual(afterFirst.container);
    expect(tree.read(AGENT_MODULE, 'utf-8')).toEqual(afterFirst.app);
  });
});
