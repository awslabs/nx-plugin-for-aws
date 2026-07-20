/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildArgs,
  createNxWorkspace,
  detectPackageManager,
  shouldSkipGit,
} from './create-nx-workspace';

const OWN_VERSION: string = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'),
).version;

describe('create-nx-workspace', () => {
  let originalUserAgent: string | undefined;

  beforeEach(() => {
    originalUserAgent = process.env.npm_config_user_agent;
    // Clear the user agent so tests don't depend on the test runner's PM
    delete process.env.npm_config_user_agent;
  });

  afterEach(() => {
    if (originalUserAgent !== undefined) {
      process.env.npm_config_user_agent = originalUserAgent;
    } else {
      delete process.env.npm_config_user_agent;
    }
  });

  describe('detectPackageManager', () => {
    it('should detect npm', () => {
      process.env.npm_config_user_agent = 'npm/10.0.0 node/v22.0.0 linux x64';
      expect(detectPackageManager()).toBe('npm');
    });

    it('should detect pnpm', () => {
      process.env.npm_config_user_agent =
        'pnpm/9.0.0 npm/? node/v22.0.0 linux x64';
      expect(detectPackageManager()).toBe('pnpm');
    });

    it('should detect yarn', () => {
      process.env.npm_config_user_agent = 'yarn/4.0.0 npm/? node/v22.0.0';
      expect(detectPackageManager()).toBe('yarn');
    });

    it('should detect bun', () => {
      process.env.npm_config_user_agent = 'bun/1.0.0 node/v22.0.0';
      expect(detectPackageManager()).toBe('bun');
    });

    it('should return undefined when no user agent', () => {
      delete process.env.npm_config_user_agent;
      expect(detectPackageManager()).toBeUndefined();
    });
  });

  describe('shouldSkipGit', () => {
    it('should return true for bare --skipGit', () => {
      expect(shouldSkipGit(['--skipGit'])).toBe(true);
    });

    it('should return true for --skipGit=true', () => {
      expect(shouldSkipGit(['--skipGit=true'])).toBe(true);
    });

    it('should return false for --skipGit=false', () => {
      expect(shouldSkipGit(['--skipGit=false'])).toBe(false);
    });

    it('should return false when --skipGit is not present', () => {
      expect(shouldSkipGit(['--no-interactive'])).toBe(false);
    });
  });

  describe('buildArgs', () => {
    it('should add --preset, default flags, and --skipGit for a simple workspace name', () => {
      expect(buildArgs(['my-project'])).toEqual([
        'my-project',
        `--preset=@aws/nx-plugin@${OWN_VERSION}`,
        '--ci=skip',
        '--analytics=false',
        '--trustThirdPartyPreset',
        '--skipGit',
      ]);
    });

    it('should auto-detect --pm from npm_config_user_agent', () => {
      process.env.npm_config_user_agent = 'bun/1.0.0';
      const result = buildArgs(['my-project']);
      expect(result).toContain('--pm=bun');
    });

    it('should not add --pm if already provided', () => {
      process.env.npm_config_user_agent = 'bun/1.0.0';
      const result = buildArgs(['my-project', '--pm=pnpm']);
      expect(result).toContain('--pm=pnpm');
      expect(result.filter((a) => a.startsWith('--pm'))).toHaveLength(1);
    });

    it('should place positional args before flags', () => {
      const result = buildArgs([
        'my-project',
        '--iacProvider=CDK',
        '--interactive=false',
      ]);
      expect(result[0]).toBe('my-project');
      expect(result[1]).toBe(`--preset=@aws/nx-plugin@${OWN_VERSION}`);
    });

    it('should place --preset before user flags', () => {
      const result = buildArgs([
        'my-project',
        '--iacProvider=CDK',
        '--interactive=false',
      ]);
      const presetIndex = result.indexOf(
        `--preset=@aws/nx-plugin@${OWN_VERSION}`,
      );
      const iacIndex = result.indexOf('--iacProvider=CDK');
      expect(presetIndex).toBeLessThan(iacIndex);
    });

    it('should place default flags before user flags', () => {
      const result = buildArgs(['my-project', '--iacProvider=CDK']);
      const ciIndex = result.indexOf('--ci=skip');
      const iacIndex = result.indexOf('--iacProvider=CDK');
      expect(ciIndex).toBeLessThan(iacIndex);
    });

    it('should not duplicate --ci if already provided', () => {
      const result = buildArgs(['my-project', '--ci=github']);
      expect(result.filter((a) => a.startsWith('--ci'))).toEqual([
        '--ci=github',
      ]);
    });

    it('should not duplicate --analytics if already provided', () => {
      const result = buildArgs(['my-project', '--analytics=true']);
      expect(result.filter((a) => a.startsWith('--analytics'))).toEqual([
        '--analytics=true',
      ]);
    });

    it('should handle --pm flag as a user flag', () => {
      const result = buildArgs(['my-project', '--pm=pnpm']);
      expect(result).toContain('--pm=pnpm');
    });

    it('should keep a space-separated flag value with its flag', () => {
      const result = buildArgs(['my-project', '--catalog', 'false']);
      // `false` is the value of `--catalog`, not a second positional arg: the
      // two stay adjacent and in order after the injected preset/default flags.
      const catalogIndex = result.indexOf('--catalog');
      expect(catalogIndex).toBeGreaterThan(-1);
      expect(result[catalogIndex + 1]).toBe('false');
      // The workspace name remains the only leading positional.
      expect(result[0]).toBe('my-project');
      expect(result[1]).toBe(`--preset=@aws/nx-plugin@${OWN_VERSION}`);
    });

    it('should handle no args', () => {
      expect(buildArgs([])).toEqual([
        `--preset=@aws/nx-plugin@${OWN_VERSION}`,
        '--ci=skip',
        '--analytics=false',
        '--trustThirdPartyPreset',
        '--skipGit',
      ]);
    });

    it('should handle multiple positional args', () => {
      const result = buildArgs(['my-project', 'extra-arg']);
      expect(result[0]).toBe('my-project');
      expect(result[1]).toBe('extra-arg');
      expect(result[2]).toBe(`--preset=@aws/nx-plugin@${OWN_VERSION}`);
    });

    it('should always pass --skipGit to nx regardless of user flags', () => {
      const result = buildArgs(['my-project', '--no-interactive']);
      expect(result).toContain('--skipGit');
    });

    it('should strip user --skipGit flag and still include our --skipGit', () => {
      const result = buildArgs(['my-project', '--skipGit']);
      expect(result.filter((a) => a === '--skipGit')).toHaveLength(1);
    });

    it('should strip user --skipGit=true flag', () => {
      const result = buildArgs(['my-project', '--skipGit=true']);
      expect(result).not.toContain('--skipGit=true');
      expect(result).toContain('--skipGit');
    });

    it('should strip user --skipGit=false flag', () => {
      const result = buildArgs(['my-project', '--skipGit=false']);
      expect(result).not.toContain('--skipGit=false');
      expect(result).toContain('--skipGit');
    });

    it('should always pass --trustThirdPartyPreset to skip the preset trust prompt', () => {
      expect(buildArgs(['my-project'])).toContain('--trustThirdPartyPreset');
    });

    it('should not duplicate --trustThirdPartyPreset if already provided', () => {
      const result = buildArgs(['my-project', '--trustThirdPartyPreset']);
      expect(
        result.filter((a) => a.startsWith('--trustThirdPartyPreset')),
      ).toHaveLength(1);
    });

    it('should preserve other user flags', () => {
      const result = buildArgs([
        'my-project',
        '--iacProvider=CDK',
        '--interactive=false',
        '--pm=pnpm',
      ]);
      expect(result).toContain('--iacProvider=CDK');
      expect(result).toContain('--interactive=false');
      expect(result).toContain('--pm=pnpm');
    });

    it('should match the expected e2e arg order', () => {
      const result = buildArgs([
        'e2e-test',
        '--iacProvider=CDK',
        '--no-interactive',
      ]);
      expect(result).toEqual([
        'e2e-test',
        `--preset=@aws/nx-plugin@${OWN_VERSION}`,
        '--ci=skip',
        '--analytics=false',
        '--trustThirdPartyPreset',
        '--skipGit',
        '--iacProvider=CDK',
        '--no-interactive',
      ]);
    });
  });

  describe('createNxWorkspace', () => {
    it('should reject --preset flag', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(createNxWorkspace(['my-project', '--preset=other'])).toBe(1);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('--preset cannot be used'),
      );
      spy.mockRestore();
    });

    it('should reject --preset= with any value', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(createNxWorkspace(['--preset=@nx/react'])).toBe(1);
      spy.mockRestore();
    });

    it('should reject bare --preset flag', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(createNxWorkspace(['my-project', '--preset'])).toBe(1);
      spy.mockRestore();
    });
  });
});
