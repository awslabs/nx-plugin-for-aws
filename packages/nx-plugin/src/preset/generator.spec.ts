/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readNxJson, type Tree } from '@nx/devkit';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_GENERATOR_NAME as TS_SYNC_GENERATOR_NAME } from '../ts/sync/generator';
import { createTreeUsingTsSolutionSetup, snapshotTreeDir } from '../utils/test';
import { isAmazonian, presetGenerator } from './generator';

const NX_TYPESCRIPT_SYNC_GENERATOR = '@nx/js:typescript-sync';

// Mock execSync to control git command behavior in tests
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execSync = vi.fn();
  return {
    ...actual,
    execSync,
    default: {
      ...actual,
      execSync,
    },
  };
});

import { execSync } from 'child_process';
import { readAwsNxPluginConfig } from '../utils/config/utils';

const mockExecSync = execSync as ReturnType<typeof vi.fn>;

describe('preset generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should run successfully', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      gitSecrets: false,
      containers: 'docker',
    });

    snapshotTreeDir(tree, '.');
  });

  it('should store CDK iac provider in config', async () => {
    await presetGenerator(tree, {
      iac: 'terraform',
      containers: 'docker',
    });

    expect((await readAwsNxPluginConfig(tree)).iac.provider).toBe('terraform');
  });

  it('should write type module for the default (esm) module format', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
    });

    expect(readJson(tree, 'package.json').type).toBe('module');
  });

  it('should write type commonjs when module is cjs', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
      module: 'cjs',
    });

    expect(readJson(tree, 'package.json').type).toBe('commonjs');
  });

  it('should enable catalogs by default and set pnpm catalogMode to prefer', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
    });

    expect((await readAwsNxPluginConfig(tree)).packageManager?.catalogs).toBe(
      true,
    );
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalogMode).toBe('prefer');
  });

  it('should disable catalogs when catalog is false and not set catalogMode', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
      catalog: false,
    });

    expect((await readAwsNxPluginConfig(tree)).packageManager?.catalogs).toBe(
      false,
    );
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalogMode).toBeUndefined();
  });

  it('should store container engine in config', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'finch',
    });

    expect((await readAwsNxPluginConfig(tree)).containers.engine).toBe('finch');
  });

  it('should store Terraform iac provider in config', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
    });

    expect((await readAwsNxPluginConfig(tree)).iac.provider).toBe('cdk');
  });

  it('should not generate git-secrets files when gitSecrets is false', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      gitSecrets: false,
    });

    expect(tree.exists('.git-secrets/git-secrets')).toBe(false);
    expect(tree.exists('.husky/pre-commit')).toBe(false);
    expect(tree.exists('.gitallowed')).toBe(false);
    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.scripts?.prepare).toBeUndefined();
    expect(packageJson.devDependencies?.husky).toBeUndefined();
  });

  it('should generate git-secrets files by default', async () => {
    await presetGenerator(tree, { iac: 'cdk' });

    expect(tree.exists('.git-secrets/git-secrets')).toBe(true);
    expect(tree.exists('.husky/pre-commit')).toBe(true);
    expect(tree.exists('.gitallowed')).toBe(true);
    const gitallowed = tree.read('.gitallowed', 'utf-8');
    expect(gitallowed).toContain('.git-secrets/git-secrets:');
    const preCommit = tree.read('.husky/pre-commit', 'utf-8');
    expect(preCommit).toContain('--register-aws');
    expect(preCommit).toContain('--pre_commit_hook');
    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.scripts.prepare).toContain('husky');
    expect(packageJson.devDependencies.husky).toBeDefined();
  });

  it('should configure MCP servers by default', async () => {
    await presetGenerator(tree, { iac: 'cdk' });

    for (const filePath of [
      '.mcp.json',
      '.cursor/mcp.json',
      '.kiro/settings/mcp.json',
      '.gemini/settings.json',
      '.vscode/mcp.json',
      '.codex/config.toml',
    ]) {
      expect(tree.exists(filePath)).toBe(true);
    }
    expect(readJson(tree, '.mcp.json').mcpServers['nx-plugin-for-aws']).toEqual(
      {
        command: 'npx',
        args: ['-y', '@aws/nx-plugin-mcp'],
      },
    );
  });

  it('should not configure MCP servers when mcp is false', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      mcp: false,
    });

    for (const filePath of [
      '.mcp.json',
      '.cursor/mcp.json',
      '.kiro/settings/mcp.json',
      '.gemini/settings.json',
      '.vscode/mcp.json',
      '.codex/config.toml',
    ]) {
      expect(tree.exists(filePath)).toBe(false);
    }
  });

  it('should disable analytics in nx.json', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
    });

    expect(readNxJson(tree).analytics).toBe(false);
  });

  it('should register the TypeScript sync generators for compile targets', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
    });

    const syncGenerators =
      readNxJson(tree).targetDefaults?.compile?.syncGenerators;

    expect(syncGenerators).toContain(TS_SYNC_GENERATOR_NAME);
    expect(syncGenerators).toContain(NX_TYPESCRIPT_SYNC_GENERATOR);
  });

  it('should add a workspace dev script that runs the dev target across projects', async () => {
    await presetGenerator(tree, {
      iac: 'cdk',
      containers: 'docker',
    });

    const packageJson = JSON.parse(tree.read('package.json').toString());
    expect(packageJson.scripts.dev).toBe('nx run-many --target dev');
  });
});

describe('isAmazonian', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  describe('when git config returns Amazon email addresses', () => {
    it('should return true for amazon.com email', () => {
      mockExecSync.mockReturnValue('john.doe@amazon.com\n');

      expect(isAmazonian()).toBe(true);
    });

    it('should return true for amazon.co.uk email', () => {
      mockExecSync.mockReturnValue('jane.smith@amazon.co.uk\n');

      expect(isAmazonian()).toBe(true);
    });

    it('should return true for amazon.de email', () => {
      mockExecSync.mockReturnValue('user@amazon.de\n');

      expect(isAmazonian()).toBe(true);
    });

    it('should return true for amazon.ca email', () => {
      mockExecSync.mockReturnValue('employee@amazon.ca\n');

      expect(isAmazonian()).toBe(true);
    });

    it('should handle mixed case Amazon domains', () => {
      mockExecSync.mockReturnValue('User@AMAZON.COM\n');

      expect(isAmazonian()).toBe(true);
    });

    it('should handle email with extra whitespace', () => {
      mockExecSync.mockReturnValue('  user@amazon.com  \n');

      expect(isAmazonian()).toBe(true);
    });
  });

  describe('when git config returns non-Amazon email addresses', () => {
    it('should return false for gmail.com email', () => {
      mockExecSync.mockReturnValue('user@gmail.com\n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for company.com email', () => {
      mockExecSync.mockReturnValue('employee@company.com\n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for email containing amazon but not as domain', () => {
      mockExecSync.mockReturnValue('amazon.user@example.com\n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for email with amazon as subdomain', () => {
      mockExecSync.mockReturnValue('user@test.amazon.example.com\n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for amazonish domain', () => {
      mockExecSync.mockReturnValue('user@amazonian.com\n');

      expect(isAmazonian()).toBe(false);
    });
  });

  describe('when git config returns invalid or empty values', () => {
    it('should return false for empty string', () => {
      mockExecSync.mockReturnValue('');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for whitespace only', () => {
      mockExecSync.mockReturnValue('   \n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for invalid email format (no @ symbol)', () => {
      mockExecSync.mockReturnValue('invalidemailformat\n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for email with no domain part', () => {
      mockExecSync.mockReturnValue('user@\n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for email with only @ symbol', () => {
      mockExecSync.mockReturnValue('@\n');

      expect(isAmazonian()).toBe(false);
    });

    it('should return false for multiple @ symbols', () => {
      mockExecSync.mockReturnValue('user@@amazon.com\n');

      expect(isAmazonian()).toBe(false);
    });
  });

  describe('when git command fails or throws errors', () => {
    it('should return false when execSync throws an error', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('git command failed');
      });

      expect(isAmazonian()).toBe(false);
    });

    it('should return false when git is not installed', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('git: command not found');
      });

      expect(isAmazonian()).toBe(false);
    });

    it('should return false when git config is not set', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: not in a git repository');
      });

      expect(isAmazonian()).toBe(false);
    });
  });

  describe('git command execution', () => {
    it('should call git config with correct parameters', () => {
      mockExecSync.mockReturnValue('user@amazon.com\n');

      isAmazonian();

      expect(mockExecSync).toHaveBeenCalledWith('git config user.email', {
        encoding: 'utf8',
      });
    });

    it('should call git config exactly once', () => {
      mockExecSync.mockReturnValue('user@amazon.com\n');

      isAmazonian();

      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });
  });
});
