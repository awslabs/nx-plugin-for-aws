/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The GritQL rewrite the version update applies to move one entry of a versions
 * constant.
 *
 * Lives here rather than beside the script so it is covered by the plugin's test
 * suite; the script supplies the names and versions.
 */

/** Whether a dependency name can be written as a bare object key. */
const isIdentifier = (name: string): boolean =>
  /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);

export interface VersionEntryRewrite {
  /** The constant holding the entry, e.g. `LAMBDA_RUNTIME_VERSIONS`. */
  readonly constantName: string;
  /** The entry's key, e.g. `python` or `@aws-sdk/client-s3`. */
  readonly name: string;
  readonly oldVersion: string;
  readonly newVersion: string;
}

/**
 * A rewrite scoped to the constant the entry belongs to.
 *
 * `versions.ts` holds several maps whose keys overlap:
 * `LAMBDA_RUNTIME_VERSIONS` and `AGENT_CORE_RUNTIME_VERSIONS` both have a
 * `python` entry, and both read `python: '3.14'`. An unscoped
 * `` `python: '3.14'` => `python: '3.15'` `` therefore moves both, whatever each
 * resolution decided. That is what the version update of 2026-11-22 did: the
 * AgentCore resolution correctly kept 3.14 and reported no change, while the
 * Lambda rewrite wrote `PYTHON_3_15` into the AgentCore pin — a runtime
 * `aws-cdk-lib` does not publish and AgentCore Runtime rejects.
 *
 * Keys are either bare identifiers (`boto3`) or string literals
 * (`'@aws-sdk/client-s3'`), depending on whether the name is a valid JS
 * identifier.
 */
export const versionEntryRewrite = ({
  constantName,
  name,
  oldVersion,
  newVersion,
}: VersionEntryRewrite): string => {
  const key = isIdentifier(name) ? name : `'${name}'`;
  return `\`const ${constantName} = $entries\` where $entries <: contains \`${key}: '${oldVersion}'\` => \`${key}: '${newVersion}'\``;
};
