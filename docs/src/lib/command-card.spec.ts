/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildCreateNxWorkspaceCommand } from '../../../packages/nx-plugin/src/utils/commands';
import {
  buildCommandTokens,
  type CardConfig,
  type CommandRequest,
  emittedValues,
  type GeneratorCardConfig,
  quoteValue,
  renderCommand,
  type WorkspaceCardConfig,
} from './command-card';
import { readGeneratorOptions } from './generator-options';

const command = (config: CardConfig, request: CommandRequest) =>
  renderCommand(buildCommandTokens(config, request));

const generatorCard = (
  overrides: Partial<GeneratorCardConfig> = {},
): GeneratorCardConfig => ({
  kind: 'generator',
  namespace: '@aws/nx-plugin',
  generator: 'ts#lambda-function',
  positional: [],
  order: [],
  prescribed: [],
  options: [],
  noInteractive: false,
  ...overrides,
});

const workspaceCard = (
  overrides: Partial<WorkspaceCardConfig> = {},
): WorkspaceCardConfig => ({
  kind: 'workspace',
  positional: ['workspace'],
  order: ['workspace', 'iac', 'module'],
  prescribed: [],
  options: [],
  ...overrides,
});

describe('generator options', () => {
  const schema = {
    properties: {
      later: { type: 'string' },
      infra: {
        type: 'string',
        enum: ['lambda', 'none'],
        default: 'lambda',
        'x-priority': 'important',
      },
      hidden: { type: 'string', 'x-priority': 'internal' },
      name: { type: 'string' },
      install: { type: 'boolean', default: true },
      count: { type: 'number' },
    },
    required: ['name'],
  };

  it('should order required options, then important, then the rest', () => {
    expect(readGeneratorOptions(schema).map((o) => o.key)).toEqual([
      'name',
      'infra',
      'later',
      'install',
      'count',
      'hidden',
    ]);
  });

  it('should read the control each option is entered with', () => {
    const controls = Object.fromEntries(
      readGeneratorOptions(schema).map((o) => [o.key, o.control]),
    );

    expect(controls).toEqual({
      name: 'text',
      infra: 'enum',
      later: 'text',
      install: 'boolean',
      count: 'number',
      hidden: 'text',
    });
  });

  it('should have no options without a schema', () => {
    expect(readGeneratorOptions(undefined)).toEqual([]);
  });
});

describe('generator command', () => {
  it('should build the bare command when no option has a value', () => {
    expect(
      command(generatorCard(), { packageManager: 'pnpm', values: {} }),
    ).toBe('pnpm nx g @aws/nx-plugin:ts#lambda-function');
  });

  it('should use each package manager’s exec prefix', () => {
    expect(
      command(generatorCard(), { packageManager: 'npm', values: {} }),
    ).toBe('npx nx g @aws/nx-plugin:ts#lambda-function');
    expect(
      command(generatorCard(), { packageManager: 'bun', values: {} }),
    ).toBe('bunx nx g @aws/nx-plugin:ts#lambda-function');
  });

  it('should pass positional options as bare arguments, in order', () => {
    expect(
      command(
        generatorCard({
          generator: 'ts#api',
          positional: ['name'],
          order: ['name', 'framework'],
          noInteractive: true,
        }),
        {
          packageManager: 'pnpm',
          values: { name: 'demo-api', framework: 'trpc' },
        },
      ),
    ).toBe(
      'pnpm nx g @aws/nx-plugin:ts#api demo-api --framework=trpc --no-interactive',
    );
  });

  it('should emit the remaining options in schema order', () => {
    expect(
      command(generatorCard({ order: ['project', 'name'] }), {
        packageManager: 'pnpm',
        values: { name: 'MyFunction', project: 'my-lib' },
      }),
    ).toBe(
      'pnpm nx g @aws/nx-plugin:ts#lambda-function --project=my-lib --name=MyFunction',
    );
  });

  it('should leave options the reader has not filled in off the command', () => {
    expect(
      command(generatorCard(), {
        packageManager: 'pnpm',
        values: { name: '', project: 'my-lib' },
      }),
    ).toBe('pnpm nx g @aws/nx-plugin:ts#lambda-function --project=my-lib');
  });

  it('should still pass an option the schema does not declare', () => {
    expect(
      command(generatorCard({ order: ['name'] }), {
        packageManager: 'pnpm',
        values: { extra: 'yes' },
      }),
    ).toBe('pnpm nx g @aws/nx-plugin:ts#lambda-function --extra=yes');
  });

  it('should append the dry run flag last', () => {
    expect(
      command(generatorCard({ noInteractive: true }), {
        packageManager: 'pnpm',
        values: { name: 'MyFunction' },
        dryRun: true,
      }),
    ).toBe(
      'pnpm nx g @aws/nx-plugin:ts#lambda-function --name=MyFunction --no-interactive --dry-run',
    );
  });

  it('should quote a value the shell would otherwise split', () => {
    expect(quoteValue('MyFunction')).toBe('MyFunction');
    expect(quoteValue('@scope/pkg')).toBe('@scope/pkg');
    expect(quoteValue('Adds a procedure')).toBe("'Adds a procedure'");
    expect(quoteValue("it's")).toBe(`'it'\\''s'`);
  });
});

describe('create workspace command', () => {
  it.each(['pnpm', 'yarn', 'npm', 'bun'])(
    'should render what the MCP server renders for %s',
    (packageManager) => {
      expect(
        command(workspaceCard(), {
          packageManager,
          values: { workspace: 'my-project' },
        }),
      ).toBe(buildCreateNxWorkspaceCommand(packageManager, 'my-project'));
    },
  );

  it('should match the MCP server with an iac provider, tag and module', () => {
    expect(
      command(workspaceCard({ tag: '1.0.0' }), {
        packageManager: 'npm',
        values: { workspace: 'my-project', iac: 'cdk', module: 'cjs' },
      }),
    ).toBe(
      buildCreateNxWorkspaceCommand('npm', 'my-project', 'cdk', '1.0.0', 'cjs'),
    );
  });

  it('should append extra arguments verbatim', () => {
    expect(
      command(workspaceCard({ extraArgs: '--catalog false' }), {
        packageManager: 'pnpm',
        values: { workspace: 'my-project' },
      }),
    ).toBe('pnpm create @aws/nx-workspace my-project --catalog false');
  });

  it('should pass the preset options the reader picks', () => {
    expect(
      command(workspaceCard({ order: ['workspace', 'iac', 'containers'] }), {
        packageManager: 'pnpm',
        values: {
          workspace: 'my-project',
          containers: 'finch',
          iac: 'terraform',
        },
      }),
    ).toBe(
      'pnpm create @aws/nx-workspace my-project --iac=terraform --containers=finch',
    );
  });
});

describe('emitted values', () => {
  const options = [
    { key: 'install', control: 'boolean' as const, default: 'true' },
    { key: 'allowSignup', control: 'boolean' as const, default: 'false' },
    { key: 'name', control: 'text' as const },
  ];

  it('should pass a boolean only where it differs from the generator default', () => {
    expect(
      emittedValues(
        { install: 'true', allowSignup: 'true', name: 'demo' },
        options,
      ),
    ).toEqual({ allowSignup: 'true', name: 'demo' });
  });

  it('should pass a cleared boolean as false rather than dropping it', () => {
    expect(emittedValues({ install: 'false' }, options)).toEqual({
      install: 'false',
    });
  });

  it('should drop empty values', () => {
    expect(emittedValues({ name: '', allowSignup: 'false' }, options)).toEqual(
      {},
    );
  });
});
