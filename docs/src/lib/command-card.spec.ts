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
  resolveCardOptions,
  type WorkspaceCardConfig,
} from './command-card';
import {
  describeWhen,
  effectiveValues,
  isApplicable,
  isValueApplicable,
  readGeneratorOptions,
} from './generator-options';
import { pinnedPageOptions } from './page-options';

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

describe('option applicability', () => {
  const schema = {
    properties: {
      framework: { type: 'string', enum: ['trpc', 'smithy'], default: 'trpc' },
      namespace: { type: 'string', 'x-when': { framework: 'smithy' } },
      auth: {
        type: 'string',
        enum: ['iam', 'cognito'],
        'x-when': { infra: ['agentcore', 'agentcore-ecr'] },
      },
    },
  };
  const [framework, namespace, auth] = readGeneratorOptions(schema);

  it('should normalise a single value and a list of them alike', () => {
    expect(namespace.when).toEqual({ framework: ['smithy'] });
    expect(auth.when).toEqual({ infra: ['agentcore', 'agentcore-ecr'] });
    expect(framework.when).toBeUndefined();
  });

  it('should apply an unconditional option whatever is chosen', () => {
    expect(isApplicable(framework, { framework: 'smithy' })).toBe(true);
  });

  it('should apply an option under the values it names', () => {
    expect(isApplicable(namespace, { framework: 'smithy' })).toBe(true);
    expect(isApplicable(auth, { infra: 'agentcore-ecr' })).toBe(true);
  });

  it('should not apply an option under any other value', () => {
    expect(isApplicable(namespace, { framework: 'trpc' })).toBe(false);
    expect(isApplicable(auth, { infra: 'none' })).toBe(false);
  });

  it('should apply an option while the value it depends on is unchosen', () => {
    expect(isApplicable(namespace, {})).toBe(true);
    expect(isApplicable(namespace, { framework: '' })).toBe(true);
  });

  it('should describe the condition for the reader', () => {
    expect(describeWhen(auth.when ?? {})).toBe(
      'infra = agentcore | agentcore-ecr',
    );
  });
});

describe('value applicability', () => {
  const schema = {
    properties: {
      framework: { type: 'string', enum: ['trpc', 'smithy'], default: 'trpc' },
      infra: {
        type: 'string',
        enum: ['rest-lambda', 'http-lambda', 'none'],
        default: 'rest-lambda',
        'x-value-when': { 'http-lambda': { framework: 'trpc' } },
      },
      session: {
        type: 'string',
        enum: ['s3', 'dynamodb-s3', 'in-memory'],
        'x-value-when': { 'dynamodb-s3': { framework: ['langchain'] } },
      },
    },
  };
  const [framework, infra, session] = readGeneratorOptions(schema);

  it('should normalise the condition on each value', () => {
    expect(infra.valueWhen).toEqual({ 'http-lambda': { framework: ['trpc'] } });
    expect(session.valueWhen).toEqual({
      'dynamodb-s3': { framework: ['langchain'] },
    });
    expect(framework.valueWhen).toBeUndefined();
  });

  it('should apply a value with no condition of its own', () => {
    expect(isValueApplicable(infra, 'none', { framework: 'smithy' })).toBe(
      true,
    );
  });

  it('should apply a conditional value under the values it names', () => {
    expect(isValueApplicable(infra, 'http-lambda', { framework: 'trpc' })).toBe(
      true,
    );
  });

  it('should rule a conditional value out under any other value', () => {
    expect(
      isValueApplicable(infra, 'http-lambda', { framework: 'smithy' }),
    ).toBe(false);
  });

  it('should read a condition against the values a run would use', () => {
    // `--session=dynamodb-s3` alone fails: `framework` falls back to its default.
    const values = effectiveValues({ session: 'dynamodb-s3' }, [
      framework,
      infra,
      session,
    ]);

    expect(values).toEqual({
      framework: 'trpc',
      infra: 'rest-lambda',
      session: 'dynamodb-s3',
    });
    expect(isValueApplicable(session, 'dynamodb-s3', values)).toBe(false);
  });

  it('should leave an entered value alone when working out what a run would use', () => {
    expect(
      effectiveValues({ framework: 'smithy' }, [framework, infra]),
    ).toEqual({ framework: 'smithy', infra: 'rest-lambda' });
  });
});

describe('page options', () => {
  it('should fix an option a page names one value for', () => {
    expect(pinnedPageOptions({ framework: ['trpc'] })).toEqual({
      framework: 'trpc',
    });
    expect(pinnedPageOptions({ framework: 'smithy' })).toEqual({
      framework: 'smithy',
    });
  });

  it('should leave an option naming several values open', () => {
    expect(
      pinnedPageOptions({ infra: ['rest-lambda', 'http-lambda'] }),
    ).toEqual({});
  });

  it('should fix nothing without a predicate', () => {
    expect(pinnedPageOptions(undefined)).toEqual({});
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

describe("resolving a card's options", () => {
  const options = readGeneratorOptions({
    properties: {
      name: { type: 'string' },
      framework: { type: 'string', enum: ['trpc', 'smithy'], default: 'trpc' },
      namespace: { type: 'string', 'x-when': { framework: 'smithy' } },
      infra: {
        type: 'string',
        enum: ['rest-lambda', 'http-lambda', 'none'],
        default: 'rest-lambda',
        'x-value-when': { 'http-lambda': { framework: 'trpc' } },
      },
    },
    required: ['name'],
  });

  it('should carry the values a page passes onto its command', () => {
    const { values } = resolveCardOptions(
      options,
      {},
      {
        name: 'demo-api',
        framework: 'trpc',
      },
    );

    expect(values).toEqual({ name: 'demo-api', framework: 'trpc' });
  });

  it('should carry a value for an option the schema does not declare', () => {
    const { values } = resolveCardOptions(options, {}, { extra: 'yes' });

    expect(values).toEqual({ extra: 'yes' });
  });

  it('should drop an option the page has ruled out, and its value with it', () => {
    const { applicable, values } = resolveCardOptions(
      options,
      { framework: 'trpc' },
      { name: 'demo-api', namespace: 'com.example' },
    );

    expect(applicable.map((option) => option.key)).not.toContain('namespace');
    expect(values).toEqual({ name: 'demo-api' });
  });

  it('should drop a value the page has ruled out from its option', () => {
    const { applicable } = resolveCardOptions(
      options,
      { framework: 'smithy' },
      {},
    );
    const infra = applicable.find((option) => option.key === 'infra');

    expect(infra?.values).toEqual(['rest-lambda', 'none']);
    expect(applicable.map((option) => option.key)).toContain('namespace');
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
