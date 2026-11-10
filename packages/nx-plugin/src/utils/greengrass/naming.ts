/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { pascalCase } from '../names.js';
import { getNpmScope } from '../npm-scope.js';

/**
 * Characters a Greengrass v2 `ComponentName` may contain. Matches the
 * `CreateComponentVersion` API's own constraint.
 */
export const COMPONENT_NAME_PATTERN = /^[a-zA-Z0-9-_.]+$/;

/** Longest `ComponentName` the `CreateComponentVersion` API accepts. */
export const MAX_COMPONENT_NAME_LENGTH = 128;

/** Longest name that fits the CDK artifact prefix with its 32-character hash. */
export const MAX_CDK_COMPONENT_NAME_LENGTH = 68;

/**
 * Prefix AWS reserves for its own public components. A user-authored
 * `ComponentName` starting with this is rejected by the service, so the
 * plugin rejects it up front with an actionable message instead.
 */
export const RESERVED_COMPONENT_NAME_PREFIX = 'aws.greengrass.';

/** Why a `ComponentName` failed validation. */
export type ComponentNameIssueReason =
  | 'invalid-characters'
  | 'too-long'
  | 'reserved-prefix';

export interface ComponentNameIssue {
  readonly reason: ComponentNameIssueReason;
  readonly message: string;
}

/**
 * Validate a `ComponentName` against the constraints the service enforces:
 * the allowed character set, the length limit, and the reserved
 * `aws.greengrass.` prefix. Returns one issue per violated constraint, empty
 * when the name is valid.
 */
export const validateComponentName = (
  componentName: string,
): ComponentNameIssue[] => {
  const issues: ComponentNameIssue[] = [];

  if (!COMPONENT_NAME_PATTERN.test(componentName)) {
    issues.push({
      reason: 'invalid-characters',
      message: `ComponentName "${componentName}" must match ${COMPONENT_NAME_PATTERN} (letters, digits, hyphens, underscores and dots only).`,
    });
  }

  if (componentName.length > MAX_COMPONENT_NAME_LENGTH) {
    issues.push({
      reason: 'too-long',
      message: `ComponentName "${componentName}" is ${componentName.length} characters long, exceeding the ${MAX_COMPONENT_NAME_LENGTH} character limit.`,
    });
  }

  if (componentName.startsWith(RESERVED_COMPONENT_NAME_PREFIX)) {
    issues.push({
      reason: 'reserved-prefix',
      message: `ComponentName "${componentName}" uses the "${RESERVED_COMPONENT_NAME_PREFIX}" prefix, which AWS reserves for its own components.`,
    });
  }

  return issues;
};

/**
 * Validate a `ComponentName`, throwing an actionable error naming every
 * violated constraint when it is invalid.
 */
export const assertValidComponentName = (componentName: string): void => {
  const issues = validateComponentName(componentName);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join(' '));
  }
};

/**
 * Reduce an npm scope to the character set {@link COMPONENT_NAME_PATTERN}
 * allows: lower-cased, any other character collapsed to a single `-`, and
 * leading/trailing separators trimmed so the result never starts or ends a
 * `ComponentName` segment with a stray punctuation mark.
 */
const sanitizeForComponentName = (segment: string): string =>
  segment
    .toLowerCase()
    .replace(/[^a-z0-9-_.]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');

/**
 * Build the default `ComponentName` for a new component: `com.<sanitized
 * workspace npm scope>.<PascalCaseName>`, the reversed-domain style the
 * service's own samples use. Reflects the workspace's npm scope at
 * generation time; re-scoping the workspace afterwards does not rename
 * already-generated components.
 */
export const buildDefaultComponentName = (tree: Tree, name: string): string =>
  `com.${sanitizeForComponentName(getNpmScope(tree) ?? 'monorepo')}.${pascalCase(name)}`;
