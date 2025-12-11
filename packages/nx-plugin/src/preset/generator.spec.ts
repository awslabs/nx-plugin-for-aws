/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readNxJson } from '@nx/devkit';
import { presetGenerator, isAmazonian } from './generator';
import { createTreeUsingTsSolutionSetup, snapshotTreeDir } from '../utils/test';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SYNC_GENERATOR_NAME as TS_SYNC_GENERATOR_NAME } from '../ts/sync/generator';

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
    await presetGenerator(tree, { addTsPlugin: false, iacProvider: 'CDK' });

    snapshotTreeDir(tree, '.');
  });

  it('should store CDK iac provider in config', async () => {
    await presetGenerator(tree, {
      addTsPlugin: false,
      iacProvider: 'Terraform',
    });

    expect((await readAwsNxPluginConfig(tree)).iac.provider).toBe('Terraform');
  });

  it('should store Terraform iac provider in config', async () => {
    await presetGenerator(tree, { addTsPlugin: false, iacProvider: 'CDK' });

    expect((await readAwsNxPluginConfig(tree)).iac.provider).toBe('CDK');
  });

  it('should register the TypeScript sync generator for compile targets', async () => {
    await presetGenerator(tree, { addTsPlugin: false, iacProvider: 'CDK' });

    expect(readNxJson(tree).targetDefaults?.compile?.syncGenerators).toContain(
      TS_SYNC_GENERATOR_NAME,
    );
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
