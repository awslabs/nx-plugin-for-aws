/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buildPackageManagerExecCommand,
  PACKAGE_MANAGER_COMMANDS,
} from '../../../packages/nx-plugin/src/utils/commands';
import type { GeneratorOption, OptionControl } from './generator-options';

/**
 * The command a card shows, assembled from the option values the reader entered.
 *
 * Shared by the cards' server render and the script that rebuilds the command as
 * the reader types, so the first paint and every keystroke agree. Two commands
 * are built this way: `nx g <generator>` and the `create @aws/nx-workspace` that
 * starts a workspace off.
 */

/** The package managers the command is offered for, in the order the tabs show them. */
export const PACKAGE_MANAGERS = [
  { label: 'pnpm', icon: 'pnpm' },
  { label: 'yarn', icon: 'seti:yarn' },
  { label: 'npm', icon: 'seti:npm' },
  { label: 'bun', icon: 'bun' },
] as const;

/** A piece of the command, tagged so the terminal block can colour it. */
export interface CommandToken {
  kind: 'exec' | 'subcommand' | 'target' | 'argument' | 'option' | 'flag';
  /** The whole token, as it appears on the command line. */
  text: string;
  /** The option an argument or option token carries a value for. */
  key?: string;
  /** An option token's `--key=` and value, coloured apart from each other. */
  label?: string;
  value?: string;
}

/** What a card needs to rebuild its command, serialised onto the card element. */
export type CardConfig = GeneratorCardConfig | WorkspaceCardConfig;

interface BaseCardConfig {
  /** Options passed as bare arguments, in the order they appear. */
  positional: string[];
  /** The order the remaining options are emitted in. */
  order: string[];
  /** The options the page pins, whose controls a reader can't drive. */
  prescribed: string[];
  options: Pick<GeneratorOption, 'key' | 'control' | 'default'>[];
}

export interface GeneratorCardConfig extends BaseCardConfig {
  kind: 'generator';
  namespace: string;
  generator: string;
  noInteractive: boolean;
}

export interface WorkspaceCardConfig extends BaseCardConfig {
  kind: 'workspace';
  /** A version tag to install the create package at, e.g. `1.0.0`. */
  tag?: string;
  /** Anything the schema doesn't cover, appended to the command verbatim. */
  extraArgs?: string;
}

export interface CommandRequest {
  packageManager: string;
  /** Values by option name. An empty value is left off the command. */
  values: Record<string, string>;
  dryRun?: boolean;
}

/**
 * Quote a value the shell would otherwise split or interpret, so a description or
 * a path with spaces stays one argument.
 */
export const quoteValue = (value: string) =>
  /^[\w.@:/+#,=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The value an option contributes to the command, or undefined when it
 * contributes nothing.
 *
 * A boolean is only passed when it differs from the generator's own default —
 * ticking a box that is on by default should leave the command alone, and
 * clearing one should pass `=false` rather than nothing.
 */
export const emittedValue = (
  value: string | undefined,
  option?: { control: OptionControl; default?: string },
): string | undefined => {
  if (value === undefined || value === '') return undefined;
  if (option?.control === 'boolean') {
    const fallback = option.default ?? 'false';
    return value === fallback ? undefined : value;
  }
  return value;
};

/** The values the reader has entered, reduced to what the command carries. */
export const emittedValues = (
  entered: Record<string, string>,
  options: readonly {
    key: string;
    control: OptionControl;
    default?: string;
  }[] = [],
): Record<string, string> => {
  const byKey = new Map(options.map((option) => [option.key, option]));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(entered)) {
    const emitted = emittedValue(value, byKey.get(key));
    if (emitted !== undefined) out[key] = emitted;
  }
  return out;
};

const argumentTokens = (
  config: CardConfig,
  values: Record<string, string>,
): CommandToken[] =>
  config.positional.flatMap((key) => {
    const value = values[key];
    return value === undefined || value === ''
      ? []
      : [{ kind: 'argument' as const, key, text: quoteValue(value) }];
  });

const optionTokens = (
  config: CardConfig,
  values: Record<string, string>,
): CommandToken[] => {
  // Options the schema declares come in its order; anything else a page passes
  // follows, so an option the schema doesn't declare still makes the command.
  const keys = [
    ...config.order,
    ...Object.keys(values).filter((key) => !config.order.includes(key)),
  ].filter((key) => !config.positional.includes(key));

  return keys.flatMap((key) => {
    const value = values[key];
    if (value === undefined || value === '') return [];
    const label = `--${key}=`;
    const quoted = quoteValue(value);
    return [
      {
        kind: 'option' as const,
        key,
        label,
        value: quoted,
        text: `${label}${quoted}`,
      },
    ];
  });
};

export const buildCommandTokens = (
  config: CardConfig,
  { packageManager, values, dryRun }: CommandRequest,
): CommandToken[] => {
  const tokens: CommandToken[] = [];

  if (config.kind === 'generator') {
    tokens.push(
      {
        kind: 'exec',
        text: buildPackageManagerExecCommand(packageManager, 'nx'),
      },
      { kind: 'subcommand', text: 'g' },
      { kind: 'target', text: `${config.namespace}:${config.generator}` },
    );
  } else {
    // Mirrors buildCreateNxWorkspaceCommand, which the MCP server renders the
    // same command with — command-card.spec.ts holds the two to the same string.
    tokens.push(
      {
        kind: 'exec',
        text:
          PACKAGE_MANAGER_COMMANDS[packageManager]?.create ??
          `${packageManager} create`,
      },
      {
        kind: 'target',
        text: config.tag
          ? `@aws/nx-workspace@${config.tag}`
          : '@aws/nx-workspace',
      },
    );
    // npm needs `--` before any flags, or it reads them as npm config.
    if (packageManager === 'npm') {
      tokens.push({ kind: 'subcommand', text: '--' });
    }
  }

  tokens.push(
    ...argumentTokens(config, values),
    ...optionTokens(config, values),
  );

  if (config.kind === 'generator' && config.noInteractive) {
    tokens.push({ kind: 'flag', text: '--no-interactive' });
  }
  if (config.kind === 'workspace' && config.extraArgs) {
    tokens.push({ kind: 'flag', text: config.extraArgs });
  }
  if (dryRun) tokens.push({ kind: 'flag', text: '--dry-run' });

  return tokens;
};

export const renderCommand = (tokens: readonly CommandToken[]) =>
  tokens.map((token) => token.text).join(' ');
