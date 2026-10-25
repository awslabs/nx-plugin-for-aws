/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree, writeJson } from '@nx/devkit';
import { tsAgentGenerator } from '../../../ts/agent/generator.js';
import { tsAgentGuardrailsGenerator } from '../../../ts/agent/guardrails/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { TERRAFORM_VERSIONS } from '../../../utils/versions.js';
import migration from './migration.js';

const GUARDRAILS_DIR = 'packages/common/terraform/src/app/guardrails';
const moduleFile = (name: string) =>
  `${GUARDRAILS_DIR}/${name}/${name}-guardrail.tf`;
const MODULE_FILE = moduleFile('my-agent');

const TIME_SLEEP = 'resource "time_sleep" "version_retention"';
const TIME_PROVIDER = 'source  = "hashicorp/time"';
const ENTRY_THROUGH_SLEEP =
  'guardrailId = time_sleep.version_retention.triggers.guardrail_id, guardrailVersion = time_sleep.version_retention.triggers.guardrail_version';
const ENTRY_DIRECT =
  'guardrailId = aws_bedrock_guardrail.this.guardrail_id, guardrailVersion = aws_bedrock_guardrail_version.this.version';

/**
 * Reverts what this migration adds, so the module is the one `ts#agent#guardrails`
 * vended from v1.1.0: no time provider, no sleep, and the entry reading the
 * guardrail and its version directly.
 */
const revertVersionRetention = (tree: Tree, filePath = MODULE_FILE) => {
  const contents = tree.read(filePath, 'utf-8');
  tree.write(
    filePath,
    contents
      .replace(
        / {4}time = \{\n {6}source {2}= "hashicorp\/time"\n {6}version = "[^"]+"\n {4}\}\n/,
        '',
      )
      .replace(
        /resource "time_sleep" "version_retention" \{[\s\S]*?\n\}\n\n/,
        '',
      )
      .replace(ENTRY_THROUGH_SLEEP, ENTRY_DIRECT),
  );
};

describe('ts-agent-guardrails-terraform-version-retention migration', () => {
  let tree: Tree;

  const addProject = (t: Tree) => {
    addProjectConfiguration(t, 'test-project', {
      root: 'apps/test-project',
      sourceRoot: 'apps/test-project/src',
      targets: {},
    });
    writeJson(t, 'apps/test-project/tsconfig.json', {});
    writeJson(t, 'apps/test-project/package.json', {
      name: 'test-project',
      version: '1.0.0',
    });
    t.write('aws-nx-plugin.config.mts', 'export default {};\n');
  };

  const guardAgent = async (
    t: Tree,
    name = 'my-agent',
    iac: 'cdk' | 'terraform' = 'terraform',
  ) => {
    await tsAgentGenerator(t, {
      project: 'test-project',
      name,
      infra: 'agentcore',
      iac,
      preferInstallDependencies: false,
    });
    await tsAgentGuardrailsGenerator(t, {
      project: 'test-project',
      agent: name,
    });
  };

  /** A workspace generated today, for comparison. */
  const freshModule = async (name = 'my-agent') => {
    const fresh = createTreeUsingTsSolutionSetup();
    addProject(fresh);
    await guardAgent(fresh, name);
    return fresh.read(moduleFile(name), 'utf-8');
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addProject(tree);
  });

  it('should be a no-op in a workspace without a guarded agent', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(GUARDRAILS_DIR)).toBe(false);
  });

  it('should start from a fixture without the wait', async () => {
    // Guards the fixture: without this the assertions below could pass without
    // the migration doing anything.
    await guardAgent(tree);
    revertVersionRetention(tree);

    const contents = tree.read(MODULE_FILE, 'utf-8');
    expect(contents).not.toContain(TIME_SLEEP);
    expect(contents).not.toContain(TIME_PROVIDER);
    expect(contents).toContain(ENTRY_DIRECT);
  });

  it('should converge on what the generator writes today', async () => {
    await guardAgent(tree);
    revertVersionRetention(tree);

    const result = await migration(tree);

    expect(tree.read(MODULE_FILE, 'utf-8')).toEqual(await freshModule());
    expect(result.nextSteps).toEqual([]);
  });

  it('should keep the version for 15 seconds through a sleep the entry reads from', async () => {
    await guardAgent(tree);
    revertVersionRetention(tree);

    await migration(tree);

    const contents = tree.read(MODULE_FILE, 'utf-8');
    expect(contents).toContain(TIME_PROVIDER);
    expect(contents).toContain(`version = "${TERRAFORM_VERSIONS.time}"`);
    expect(contents).toContain(TIME_SLEEP);
    expect(contents).toContain('destroy_duration = "15s"');
    expect(contents).toContain(ENTRY_THROUGH_SLEEP);
    // The module's outputs still read the guardrail and its version directly.
    expect(contents).toContain(
      'value       = aws_bedrock_guardrail_version.this.version',
    );
  });

  it('should be a no-op on a freshly generated module', async () => {
    await guardAgent(tree);
    const before = tree.read(MODULE_FILE, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(MODULE_FILE, 'utf-8')).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await guardAgent(tree);
    revertVersionRetention(tree);

    await migration(tree);
    const once = tree.read(MODULE_FILE, 'utf-8');
    const result = await migration(tree);

    expect(tree.read(MODULE_FILE, 'utf-8')).toEqual(once);
    expect(once.split(TIME_SLEEP)).toHaveLength(2);
    expect(once.split(TIME_PROVIDER)).toHaveLength(2);
    expect(result.nextSteps).toEqual([]);
  });

  it('should migrate the module of every guarded Terraform agent', async () => {
    await guardAgent(tree, 'my-agent');
    await guardAgent(tree, 'other-agent');
    revertVersionRetention(tree, moduleFile('my-agent'));
    revertVersionRetention(tree, moduleFile('other-agent'));

    const result = await migration(tree);

    expect(tree.read(moduleFile('my-agent'), 'utf-8')).toEqual(
      await freshModule('my-agent'),
    );
    expect(tree.read(moduleFile('other-agent'), 'utf-8')).toEqual(
      await freshModule('other-agent'),
    );
    expect(result.nextSteps).toEqual([]);
  });

  it('should not add a second time provider the user already declared', async () => {
    await guardAgent(tree);
    revertVersionRetention(tree);
    const withTime = tree
      .read(MODULE_FILE, 'utf-8')
      .replace(
        '  required_providers {\n',
        `  required_providers {\n    time = {\n      source  = "hashicorp/time"\n      version = ">= 0.9"\n    }\n`,
      );
    tree.write(MODULE_FILE, withTime);

    await migration(tree);

    const contents = tree.read(MODULE_FILE, 'utf-8');
    expect(contents.split(TIME_PROVIDER)).toHaveLength(2);
    expect(contents).toContain('version = ">= 0.9"');
    expect(contents).toContain(TIME_SLEEP);
    expect(contents).toContain(ENTRY_THROUGH_SLEEP);
  });

  it('should leave a diverged module untouched and say what to add', async () => {
    await guardAgent(tree);
    revertVersionRetention(tree);
    // The user builds the runtime-config entry another way.
    const diverged = tree
      .read(MODULE_FILE, 'utf-8')
      .replace(
        ENTRY_DIRECT,
        'guardrailId = local.id, guardrailVersion = local.version',
      );
    tree.write(MODULE_FILE, diverged);

    const result = await migration(tree);

    expect(tree.read(MODULE_FILE, 'utf-8')).toEqual(diverged);
    expect(result.nextSteps).toHaveLength(1);
    const [message] = result.nextSteps;
    expect(message).toMatch(
      new RegExp(
        `^${MODULE_FILE}: has diverged from the generated shape - left untouched\\.`,
      ),
    );
    expect(message).toContain(TIME_PROVIDER);
    expect(message).toContain(TIME_SLEEP);
    expect(message).toContain('destroy_duration = "15s"');
    expect(message).toContain(
      'guardrailVersion = time_sleep.version_retention.triggers.guardrail_version',
    );
  });

  it('should leave CDK-guarded agents and unguarded Terraform agents alone', async () => {
    await guardAgent(tree, 'cdk-agent', 'cdk');
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'plain-agent',
      infra: 'agentcore',
      iac: 'terraform',
      preferInstallDependencies: false,
    });
    // A module left over at the unguarded agent's path is not this migration's.
    tree.write(moduleFile('plain-agent'), 'resource "null_resource" "x" {}\n');

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.read(moduleFile('plain-agent'), 'utf-8')).toEqual(
      'resource "null_resource" "x" {}\n',
    );
  });

  it('should skip a guarded agent whose module was removed', async () => {
    await guardAgent(tree);
    tree.delete(MODULE_FILE);

    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(MODULE_FILE)).toBe(false);
  });
});
