/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  ALLOWED_TOOLS_MAX_ITEMS,
  DEFAULT_HARNESS_ALLOWED_TOOLS,
  DEFAULT_HARNESS_DIRECTORY,
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
  resolveAgentcoreHarnessOptions,
} from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

describe('agentcore-harness resolve options', () => {
  let tree: Tree;

  const resolve = (options: Partial<AgentcoreHarnessGeneratorSchema>) =>
    resolveAgentcoreHarnessOptions(tree, {
      name: 'my-harness',
      ...options,
    } as AgentcoreHarnessGeneratorSchema);

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('generator-side defaults', () => {
    it('exports the exact documented creation defaults', () => {
      expect(DEFAULT_HARNESS_MODEL_ID).toBe(
        'global.anthropic.claude-sonnet-4-6',
      );
      expect(DEFAULT_HARNESS_SYSTEM_PROMPT).toBe(
        'You are a helpful AI assistant.',
      );
      expect(DEFAULT_HARNESS_ALLOWED_TOOLS).toEqual(['@builtin']);
      expect(DEFAULT_HARNESS_DIRECTORY).toBe('packages');
    });

    it('applies the exact defaults when every optional option is omitted', () => {
      const resolved = resolve({});

      expect(resolved.modelId).toBe('global.anthropic.claude-sonnet-4-6');
      expect(resolved.systemPrompt).toBe('You are a helpful AI assistant.');
      expect(resolved.allowedTools).toEqual(['@builtin']);
      expect(resolved.infra).toBe('agentcore');
      expect(resolved.iac).toBe('inherit');
      expect(resolved.preferInstallDependencies).toBe(true);
      expect(resolved.nameKebabCase).toBe('my-harness');
      expect(resolved.nameClassName).toBe('MyHarness');
      expect(resolved.fullyQualifiedProjectName).toBe('@proj/my-harness');
      expect(resolved.projectRoot).toBe('packages/my-harness');
      expect(resolved.runtimeConfigPath).toBe('agentcore.harnesses.MyHarness');
      expect(resolved.auth).toBe('iam');
    });

    it('preserves omitted execution limits as undefined', () => {
      const resolved = resolve({});
      expect(resolved.maxIterations).toBeUndefined();
      expect(resolved.maxTokens).toBeUndefined();
      expect(resolved.timeoutSeconds).toBeUndefined();
    });

    it('preserves explicitly supplied values instead of defaults', () => {
      const resolved = resolve({
        modelId: 'custom.model-id',
        systemPrompt: 'Custom prompt.',
        allowedTools: ['tool-one', 'tool-two'],
        maxIterations: 5,
        maxTokens: 4096,
        timeoutSeconds: 300,
        infra: 'none',
        iac: 'terraform',
        preferInstallDependencies: false,
      });

      expect(resolved.modelId).toBe('custom.model-id');
      expect(resolved.systemPrompt).toBe('Custom prompt.');
      expect(resolved.allowedTools).toEqual(['tool-one', 'tool-two']);
      expect(resolved.maxIterations).toBe(5);
      expect(resolved.maxTokens).toBe(4096);
      expect(resolved.timeoutSeconds).toBe(300);
      expect(resolved.infra).toBe('none');
      expect(resolved.iac).toBe('terraform');
      expect(resolved.preferInstallDependencies).toBe(false);
    });

    it('resolves placement as join(directory ?? packages, subDirectory ?? kebab name)', () => {
      expect(resolve({}).projectRoot).toBe('packages/my-harness');
      expect(resolve({ directory: 'apps' }).projectRoot).toBe(
        'apps/my-harness',
      );
      expect(resolve({ subDirectory: 'custom-dir' }).projectRoot).toBe(
        'packages/custom-dir',
      );
      expect(
        resolve({ directory: 'apps', subDirectory: 'nested/harness' })
          .projectRoot,
      ).toBe('apps/nested/harness');
    });

    it('normalizes mixed-case names into kebab-case and PascalCase identity', () => {
      const resolved = resolve({ name: 'My AgentCore Harness' });
      expect(resolved.nameKebabCase).toBe('my-agent-core-harness');
      expect(resolved.nameClassName).toBe('MyAgentCoreHarness');
      expect(resolved.projectRoot).toBe('packages/my-agent-core-harness');
      expect(resolved.runtimeConfigPath).toBe(
        'agentcore.harnesses.MyAgentCoreHarness',
      );
    });

    it('copies allowed tools so callers cannot alias resolved options', () => {
      const supplied = ['tool-one'];
      const resolved = resolve({ allowedTools: supplied });
      supplied.push('tool-two');
      expect(resolved.allowedTools).toEqual(['tool-one']);

      const defaulted = resolve({});
      expect(defaulted.allowedTools).not.toBe(DEFAULT_HARNESS_ALLOWED_TOOLS);
      expect(defaulted.allowedTools).toEqual([
        ...DEFAULT_HARNESS_ALLOWED_TOOLS,
      ]);
    });
  });

  describe('name rejections', () => {
    it('rejects whitespace-only names, naming the option', () => {
      expect(() => resolve({ name: '   \t ' })).toThrow(
        /Invalid option 'name'.*non-whitespace/,
      );
    });

    it('rejects names that normalize to an empty project identifier', () => {
      for (const name of ['--', '!!!', '...']) {
        expect(() => resolve({ name })).toThrow(
          /Invalid option 'name'.*normalizes to an empty project identifier/,
        );
      }
    });
  });

  describe('placement rejections', () => {
    it('rejects whitespace-only path fragments', () => {
      expect(() => resolve({ directory: '   ' })).toThrow(
        /Invalid option 'directory'/,
      );
      expect(() => resolve({ subDirectory: '   ' })).toThrow(
        /Invalid option 'subDirectory'/,
      );
    });

    it('rejects absolute paths', () => {
      expect(() => resolve({ directory: '/absolute/path' })).toThrow(
        /Invalid option 'directory'.*relative path/,
      );
      expect(() => resolve({ directory: 'C:\\windows\\path' })).toThrow(
        /Invalid option 'directory'/,
      );
      expect(() => resolve({ subDirectory: '/absolute' })).toThrow(
        /Invalid option 'subDirectory'.*relative path/,
      );
    });

    it('rejects parent-directory traversal', () => {
      expect(() => resolve({ directory: '../escape' })).toThrow(
        /Invalid option 'directory'.*parent directory/,
      );
      expect(() => resolve({ directory: 'nested/../../escape' })).toThrow(
        /Invalid option 'directory'.*parent directory/,
      );
      expect(() => resolve({ subDirectory: '..' })).toThrow(
        /Invalid option 'subDirectory'.*parent directory/,
      );
    });

    it('accepts nested relative path fragments', () => {
      const resolved = resolve({
        directory: 'apps/agents',
        subDirectory: 'harnesses/mine',
      });
      expect(resolved.projectRoot).toBe('apps/agents/harnesses/mine');
    });
  });

  describe('string option rejections', () => {
    it('rejects whitespace-only modelId and systemPrompt, naming the option', () => {
      expect(() => resolve({ modelId: ' ' })).toThrow(
        /Invalid option 'modelId'.*non-whitespace/,
      );
      expect(() => resolve({ systemPrompt: '\n\t' })).toThrow(
        /Invalid option 'systemPrompt'.*non-whitespace/,
      );
    });
  });

  describe('allowed-tool boundaries', () => {
    it('rejects an empty allowedTools array (0 entries)', () => {
      expect(() => resolve({ allowedTools: [] })).toThrow(
        /Invalid option 'allowedTools'.*between 1 and 64/,
      );
    });

    it('accepts exactly 1 entry', () => {
      expect(resolve({ allowedTools: ['@builtin'] }).allowedTools).toEqual([
        '@builtin',
      ]);
    });

    it('accepts exactly 64 entries', () => {
      const tools = Array.from(
        { length: ALLOWED_TOOLS_MAX_ITEMS },
        (_, i) => `tool-${i}`,
      );
      expect(resolve({ allowedTools: tools }).allowedTools).toHaveLength(64);
    });

    it('rejects 65 entries', () => {
      const tools = Array.from(
        { length: ALLOWED_TOOLS_MAX_ITEMS + 1 },
        (_, i) => `tool-${i}`,
      );
      expect(() => resolve({ allowedTools: tools })).toThrow(
        /Invalid option 'allowedTools'.*between 1 and 64.*65/,
      );
    });

    it('rejects whitespace-only tool entries, identifying the entry', () => {
      expect(() => resolve({ allowedTools: ['valid', '   '] })).toThrow(
        /Invalid option 'allowedTools'.*index 1.*non-whitespace/,
      );
    });
  });

  describe('execution-limit boundaries', () => {
    const limitOptions = [
      'maxIterations',
      'maxTokens',
      'timeoutSeconds',
    ] as const;

    const limitOption = (
      option: (typeof limitOptions)[number],
      value: number,
    ): Partial<AgentcoreHarnessGeneratorSchema> => {
      const options: Partial<AgentcoreHarnessGeneratorSchema> = {};
      options[option] = value;
      return options;
    };

    it.each(limitOptions)('accepts 1 for %s', (option) => {
      expect(resolve(limitOption(option, 1))[option]).toBe(1);
    });

    it.each(limitOptions)('rejects 0 for %s', (option) => {
      expect(() => resolve(limitOption(option, 0))).toThrow(
        new RegExp(`Invalid option '${option}'.*positive integer`),
      );
    });

    it.each(limitOptions)('rejects negative values for %s', (option) => {
      expect(() => resolve(limitOption(option, -5))).toThrow(
        new RegExp(`Invalid option '${option}'.*positive integer`),
      );
    });

    it.each(limitOptions)('rejects non-integer values for %s', (option) => {
      expect(() => resolve(limitOption(option, 1.5))).toThrow(
        new RegExp(`Invalid option '${option}'.*positive integer`),
      );
    });
  });

  describe('enum rejections', () => {
    it('rejects invalid infra values, naming the option and allowed values', () => {
      expect(() =>
        resolve({
          infra: 'invalid' as AgentcoreHarnessGeneratorSchema['infra'],
        }),
      ).toThrow(/Invalid option 'infra'.*agentcore, none/);
    });

    it('rejects invalid iac values, naming the option and allowed values', () => {
      expect(() =>
        resolve({ iac: 'pulumi' as AgentcoreHarnessGeneratorSchema['iac'] }),
      ).toThrow(/Invalid option 'iac'.*inherit, cdk, terraform/);
    });
  });
});
