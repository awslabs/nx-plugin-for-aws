/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { terraformProjectGenerator } from '../../../terraform/project/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT = '@proj/infra';
const PROJECT_ROOT = 'packages/infra';
const CHECKOV_CONFIG = `${PROJECT_ROOT}/checkov.yml`;
const BOOTSTRAP_DESTROY_SCRIPT = `${PROJECT_ROOT}/scripts/bootstrap-destroy.ts`;
const SRC_PROVIDERS = `${PROJECT_ROOT}/src/providers.tf`;
const BOOTSTRAP_PROVIDERS = `${PROJECT_ROOT}/bootstrap/providers.tf`;

/** The scan command as it was vended before the fix, on the `test` target. */
const PRE_FIX_CHECKOV_COMMAND =
  'uvx --from checkov==3.3.13 checkov --directory . -o cli -o json --output-file-path console,../../dist/{projectRoot}/checkov/checkov_report.json';

const PRE_FIX_SRC_PROVIDERS = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
`;

const PRE_FIX_BOOTSTRAP_PROVIDERS = `provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
`;

/**
 * Generates a terraform application project, then reverts everything this
 * migration fixes back to the shape the pre-fix generator produced.
 */
const generatePreFixProject = async (tree: Tree, type = 'application') => {
  await terraformProjectGenerator(tree, {
    name: 'infra',
    type: type as 'application' | 'library',
    directory: 'packages',
  });

  const config = readProjectConfiguration(tree, PROJECT);
  delete config.targets.checkov;
  // Pre-fix, `build` depended on the scan through `test`.
  config.targets.build.dependsOn = config.targets.build.dependsOn.filter(
    (d: string) => d !== 'checkov',
  );
  config.targets.test = {
    executor: 'nx:run-commands',
    cache: true,
    outputs: ['{workspaceRoot}/dist/{projectRoot}/checkov'],
    options: {
      command: PRE_FIX_CHECKOV_COMMAND,
      forwardAllArgs: true,
      cwd: '{projectRoot}/src',
    },
  };
  if (type === 'application') {
    config.targets['bootstrap-destroy'] = {
      executor: 'nx:run-commands',
      options: {
        forwardAllArgs: true,
        command:
          'terraform destroy -state=../../dist/{projectRoot}/terraform/bootstrap.tfstate',
        cwd: '{projectRoot}/bootstrap',
      },
    };
  }
  updateProjectConfiguration(tree, PROJECT, config);

  tree.delete(CHECKOV_CONFIG);
  tree.write(SRC_PROVIDERS, PRE_FIX_SRC_PROVIDERS);
  if (type === 'application') {
    tree.delete(BOOTSTRAP_DESTROY_SCRIPT);
    tree.write(BOOTSTRAP_PROVIDERS, PRE_FIX_BOOTSTRAP_PROVIDERS);
  }
};

describe('terraform-project-checkov-target-and-bootstrap-destroy migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should start from a fixture that lacks the fixes', () => {
    // Guards the fixture: without this, the assertions below could pass
    // without the migration doing anything.
    expect(PRE_FIX_SRC_PROVIDERS).not.toContain('required_version');
    expect(PRE_FIX_BOOTSTRAP_PROVIDERS).not.toContain('required_version');
    expect(PRE_FIX_CHECKOV_COMMAND).not.toContain('--config-file');
  });

  it('should be a no-op when the workspace has no terraform project', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should add checkov, leaving the existing test target untouched', async () => {
    await generatePreFixProject(tree);
    const testBefore = readProjectConfiguration(tree, PROJECT).targets.test;

    const result = await migration(tree);

    const targets = readProjectConfiguration(tree, PROJECT).targets;
    expect(targets.checkov.options.command).toContain('uvx --from checkov==');
    expect(targets.checkov.options.command).toContain(
      '--config-file ../checkov.yml',
    );
    expect(targets.checkov.cache).toBe(true);
    // An existing workspace's `test` target is the user's, so the migration
    // adds `checkov` alongside it rather than rewriting it.
    expect(targets.test).toEqual(testBefore);
    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve every pre-existing target name', async () => {
    await generatePreFixProject(tree);
    const before = Object.keys(
      readProjectConfiguration(tree, PROJECT).targets,
    ).sort();

    await migration(tree);

    const after = Object.keys(readProjectConfiguration(tree, PROJECT).targets);
    for (const target of before) {
      expect(after).toContain(target);
    }
    expect(after).toContain('checkov');
  });

  it('should vend a checkov config', async () => {
    await generatePreFixProject(tree);

    await migration(tree);

    expect(tree.read(CHECKOV_CONFIG, 'utf-8')).toContain('skip-check:');
  });

  it('should make bootstrap-destroy pass the region', async () => {
    await generatePreFixProject(tree);

    const result = await migration(tree);

    const bootstrapDestroy = readProjectConfiguration(tree, PROJECT).targets[
      'bootstrap-destroy'
    ];
    expect(bootstrapDestroy.options.commands).toEqual([
      'tsx {projectRoot}/scripts/bootstrap-destroy.ts {projectRoot}',
    ]);
    expect(bootstrapDestroy.options.cwd).toBe('{workspaceRoot}');
    // The old inline command is what prompted for `aws_region`.
    expect(bootstrapDestroy.options.command).toBeUndefined();

    const script = tree.read(BOOTSTRAP_DESTROY_SCRIPT, 'utf-8');
    expect(script).toContain('`-var=aws_region=${region}`');
    expect(script).toContain("'-auto-approve'");
    expect(result.nextSteps).toEqual([]);
  });

  it('should add required_version to both providers.tf', async () => {
    await generatePreFixProject(tree);

    await migration(tree);

    for (const providersPath of [SRC_PROVIDERS, BOOTSTRAP_PROVIDERS]) {
      expect(tree.read(providersPath, 'utf-8')).toContain(
        'required_version = ">= 1.0"',
      );
    }
    // The existing provider pin is preserved rather than replaced.
    expect(tree.read(SRC_PROVIDERS, 'utf-8')).toContain('hashicorp/aws');
    expect(tree.read(SRC_PROVIDERS, 'utf-8')).toContain('backend "s3"');
  });

  it('should migrate a library project without a bootstrap dir', async () => {
    await generatePreFixProject(tree, 'library');

    const result = await migration(tree);

    const targets = readProjectConfiguration(tree, PROJECT).targets;
    expect(targets.checkov.options.command).toContain('uvx --from checkov==');
    expect(tree.exists(BOOTSTRAP_DESTROY_SCRIPT)).toBeFalsy();
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave an already-generated project untouched and unreported', async () => {
    await terraformProjectGenerator(tree, {
      name: 'infra',
      type: 'application',
      directory: 'packages',
    });
    const before = tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8')).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generatePreFixProject(tree);
    await migration(tree);

    const projectJson = tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8');
    const srcProviders = tree.read(SRC_PROVIDERS, 'utf-8');
    const bootstrapProviders = tree.read(BOOTSTRAP_PROVIDERS, 'utf-8');

    const result = await migration(tree);

    expect(tree.read(`${PROJECT_ROOT}/project.json`, 'utf-8')).toEqual(
      projectJson,
    );
    expect(tree.read(SRC_PROVIDERS, 'utf-8')).toEqual(srcProviders);
    expect(tree.read(BOOTSTRAP_PROVIDERS, 'utf-8')).toEqual(bootstrapProviders);
    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve a user-curated checkov config', async () => {
    await generatePreFixProject(tree);
    tree.write(CHECKOV_CONFIG, 'skip-check:\n  - CKV_AWS_999\n');

    await migration(tree);

    expect(tree.read(CHECKOV_CONFIG, 'utf-8')).toContain('CKV_AWS_999');
  });

  it('should skip and report a diverged test target', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.test = {
      executor: 'nx:run-commands',
      options: { command: 'my-own-scanner --strict' },
    };
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    const targets = readProjectConfiguration(tree, PROJECT).targets;
    expect(targets.test.options.command).toBe('my-own-scanner --strict');
    expect(targets.checkov).toBeUndefined();
    expect(result.nextSteps.join('\n')).toContain(PROJECT);
    expect(result.nextSteps.join('\n')).toContain("'test' target");
  });

  it('should skip and report a diverged bootstrap-destroy target', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets['bootstrap-destroy'] = {
      executor: 'nx:run-commands',
      options: { command: 'terraform destroy -var-file=custom.tfvars' },
    };
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    expect(
      readProjectConfiguration(tree, PROJECT).targets['bootstrap-destroy']
        .options.command,
    ).toBe('terraform destroy -var-file=custom.tfvars');
    expect(result.nextSteps.join('\n')).toContain('bootstrap-destroy');
  });

  it('should leave a providers.tf that already declares required_version alone', async () => {
    await generatePreFixProject(tree);
    const custom = PRE_FIX_SRC_PROVIDERS.replace(
      'terraform {',
      'terraform {\n  required_version = ">= 1.5"\n',
    );
    tree.write(SRC_PROVIDERS, custom);

    await migration(tree);

    // The user's stricter constraint is theirs to keep.
    expect(tree.read(SRC_PROVIDERS, 'utf-8')).toContain(
      'required_version = ">= 1.5"',
    );
    expect(tree.read(SRC_PROVIDERS, 'utf-8')).not.toContain('">= 1.0"');
  });
});
