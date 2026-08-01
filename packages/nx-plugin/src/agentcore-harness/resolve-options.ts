/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import type { IacOption } from '../utils/iac';
import { kebabCase, toClassName } from '../utils/names';
import { getNpmScopePrefix } from '../utils/npm-scope';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

/** Default parent directory applied when `directory` is omitted. */
export const DEFAULT_HARNESS_DIRECTORY = 'packages';

const INFRA_VALUES = ['agentcore', 'none'] as const;
const IAC_VALUES = ['inherit', 'cdk', 'terraform'] as const;

/**
 * Generator options after schema-predicate validation and default
 * resolution. All validation happens before the generator mutates the Nx
 * tree.
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
  infra: 'agentcore' | 'none';
  iac: IacOption;
  preferInstallDependencies: boolean;
  /** IAM is the only inbound authorization mode. */
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

/**
 * Validate raw generator options against the schema predicates and resolve
 * defaults.
 *
 * Mirrors the schema.json predicates so programmatic invocations receive
 * the same guarantees as Nx CLI schema validation: every rejection names
 * the offending option and is thrown before the generator mutates the Nx
 * tree or invokes infrastructure helpers.
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
    infra: options.infra ?? 'agentcore',
    iac: options.iac ?? 'inherit',
    preferInstallDependencies: options.preferInstallDependencies ?? true,
    auth: 'iam',
  };
};
