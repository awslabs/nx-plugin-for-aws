/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import type { IacOption } from '../utils/iac';
import { kebabCase, toClassName } from '../utils/names';
import { getNpmScopePrefix } from '../utils/npm-scope';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

/** Exact MVP default Bedrock model ID applied when `modelId` is omitted. */
export const DEFAULT_HARNESS_MODEL_ID = 'global.anthropic.claude-sonnet-4-6';

/** Exact MVP default system prompt applied when `systemPrompt` is omitted. */
export const DEFAULT_HARNESS_SYSTEM_PROMPT = 'You are a helpful AI assistant.';

/**
 * Exact MVP default allowed-tool patterns applied when `allowedTools` is
 * omitted. Resolution copies this array before handing it to callers so
 * caller mutation cannot alter this module-level constant.
 */
export const DEFAULT_HARNESS_ALLOWED_TOOLS: readonly string[] = ['@builtin'];

/** Default parent directory applied when `directory` is omitted. */
export const DEFAULT_HARNESS_DIRECTORY = 'packages';

/** Bounds for the number of `allowedTools` entries (inclusive). */
export const ALLOWED_TOOLS_MIN_ITEMS = 1;
export const ALLOWED_TOOLS_MAX_ITEMS = 64;

const INFRA_VALUES = ['agentcore', 'none'] as const;
const IAC_VALUES = ['inherit', 'cdk', 'terraform'] as const;

/**
 * Generator options after schema-predicate validation and exact default
 * resolution. All validation happens before the generator mutates the Nx
 * tree; omitted execution limits stay `undefined` so infrastructure can
 * apply provider-equivalent null behaviour.
 */
export interface ResolvedAgentcoreHarnessOptions {
  /** Non-empty kebab-case project name segment. */
  nameKebabCase: string;
  /** Non-empty PascalCase runtime configuration key segment. */
  nameClassName: string;
  /** Workspace npm-scope qualified project name. */
  fullyQualifiedProjectName: string;
  /** `join(directory ?? 'packages', subDirectory ?? nameKebabCase)`. */
  projectRoot: string;
  modelId: string;
  systemPrompt: string;
  allowedTools: readonly string[];
  maxIterations?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  infra: 'agentcore' | 'none';
  iac: IacOption;
  preferInstallDependencies: boolean;
  /** Runtime configuration key path registered for the deployed harness. */
  runtimeConfigPath: `agentcore.harnesses.${string}`;
  /** IAM is the only inbound authorization mode for the MVP. */
  auth: 'iam';
}

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

/**
 * Reject an option whose value violates a schema predicate. Thrown before
 * any tree mutation so generation terminates without invoking
 * infrastructure helpers, and named so diagnostics identify the option.
 */
const invalidOption = (option: string, reason: string): Error =>
  new Error(`Invalid option '${option}': ${reason}`);

const validateNonWhitespaceString = (
  option: string,
  value: string | undefined,
): void => {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || !containsNonWhitespace(value)) {
    throw invalidOption(
      option,
      'must contain at least one non-whitespace character',
    );
  }
};

/**
 * Placement options must be non-empty relative path fragments with no
 * parent-directory traversal, so a generated project root can never escape
 * the workspace.
 */
const validatePathFragment = (
  option: string,
  value: string | undefined,
): void => {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || !containsNonWhitespace(value)) {
    throw invalidOption(option, 'must be a non-empty relative path fragment');
  }
  if (/^[\\/]/.test(value) || /^[A-Za-z]:/.test(value)) {
    throw invalidOption(
      option,
      `'${value}' must be a relative path, not an absolute path`,
    );
  }
  if (value.split(/[\\/]/).some((segment) => segment === '..')) {
    throw invalidOption(
      option,
      `'${value}' must not contain parent directory ('..') segments`,
    );
  }
};

const validatePositiveInteger = (
  option: string,
  value: number | undefined,
): void => {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalidOption(
      option,
      `must be a positive integer (received ${value})`,
    );
  }
};

const validateEnumValue = <T extends string>(
  option: string,
  value: string | undefined,
  allowed: readonly T[],
): void => {
  if (value === undefined) {
    return;
  }
  if (!allowed.includes(value as T)) {
    throw invalidOption(
      option,
      `'${value}' must be one of ${allowed.join(', ')}`,
    );
  }
};

const validateAllowedTools = (value: string[] | undefined): void => {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw invalidOption('allowedTools', 'must be an array of tool patterns');
  }
  if (
    value.length < ALLOWED_TOOLS_MIN_ITEMS ||
    value.length > ALLOWED_TOOLS_MAX_ITEMS
  ) {
    throw invalidOption(
      'allowedTools',
      `must contain between ${ALLOWED_TOOLS_MIN_ITEMS} and ${ALLOWED_TOOLS_MAX_ITEMS} entries (received ${value.length})`,
    );
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !containsNonWhitespace(entry)) {
      throw invalidOption(
        'allowedTools',
        `entry at index ${index} must contain at least one non-whitespace character`,
      );
    }
  });
};

/**
 * Validate raw generator options against the schema predicates and resolve
 * the exact MVP defaults.
 *
 * Mirrors the schema.json predicates so programmatic invocations receive
 * the same guarantees as Nx CLI schema validation: every rejection names
 * the offending option and is thrown before the generator mutates the Nx
 * tree or invokes infrastructure helpers. Omitted execution limits remain
 * `undefined` (provider null behaviour); all other omitted options resolve
 * to the documented creation defaults.
 */
export const resolveAgentcoreHarnessOptions = (
  tree: Tree,
  options: AgentcoreHarnessGeneratorSchema,
): ResolvedAgentcoreHarnessOptions => {
  if (
    typeof options.name !== 'string' ||
    !containsNonWhitespace(options.name)
  ) {
    throw invalidOption(
      'name',
      'must contain at least one non-whitespace character',
    );
  }
  validatePathFragment('directory', options.directory);
  validatePathFragment('subDirectory', options.subDirectory);
  validateNonWhitespaceString('modelId', options.modelId);
  validateNonWhitespaceString('systemPrompt', options.systemPrompt);
  validateAllowedTools(options.allowedTools);
  validatePositiveInteger('maxIterations', options.maxIterations);
  validatePositiveInteger('maxTokens', options.maxTokens);
  validatePositiveInteger('timeoutSeconds', options.timeoutSeconds);
  validateEnumValue('infra', options.infra, INFRA_VALUES);
  validateEnumValue('iac', options.iac, IAC_VALUES);

  const nameKebabCase = kebabCase(options.name);
  const nameClassName = toClassName(nameKebabCase);
  if (!nameKebabCase || !nameClassName) {
    throw invalidOption(
      'name',
      `'${options.name}' normalizes to an empty project identifier; choose a name containing letters or digits (eg. my-harness)`,
    );
  }

  return {
    nameKebabCase,
    nameClassName,
    fullyQualifiedProjectName: `${getNpmScopePrefix(tree)}${nameKebabCase}`,
    projectRoot: joinPathFragments(
      options.directory ?? DEFAULT_HARNESS_DIRECTORY,
      options.subDirectory ?? nameKebabCase,
    ),
    modelId: options.modelId ?? DEFAULT_HARNESS_MODEL_ID,
    systemPrompt: options.systemPrompt ?? DEFAULT_HARNESS_SYSTEM_PROMPT,
    // Copy so neither the module-level default nor the caller's array is
    // aliased by the resolved options.
    allowedTools: [...(options.allowedTools ?? DEFAULT_HARNESS_ALLOWED_TOOLS)],
    maxIterations: options.maxIterations,
    maxTokens: options.maxTokens,
    timeoutSeconds: options.timeoutSeconds,
    infra: options.infra ?? 'agentcore',
    iac: options.iac ?? 'inherit',
    preferInstallDependencies: options.preferInstallDependencies ?? true,
    runtimeConfigPath: `agentcore.harnesses.${nameClassName}`,
    auth: 'iam',
  };
};
