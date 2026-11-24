/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { applyGritQL } from './ast.js';

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

/**
 * Applies {@link versionEntryRewrite} to the versions file, and throws when the
 * rewrite moved nothing.
 *
 * A GritQL pattern that matches nothing is not an error, so without this check a
 * rewrite that found no entry left the file untouched while the caller had
 * already recorded the bump for the PR body — a version the PR claims to have
 * moved, in a file where it has not. `applyGritQL` reports whether it wrote new
 * content, which answers both ways of missing: a constant renamed in
 * `versions.ts` without the caller's name being updated, and a key or current
 * version the constant does not hold.
 *
 * An entry whose versions are equal has nothing to move, so it returns before
 * the rewrite. GritQL treats rewriting a string into itself as no change, so
 * without this a caller that skipped its own old-equals-new check would fail the
 * whole weekly run over a version that is already where it should be.
 */
export const applyVersionEntryRewrite = async (
  tree: Tree,
  versionsFilePath: string,
  entry: VersionEntryRewrite,
): Promise<void> => {
  if (entry.oldVersion === entry.newVersion) {
    return;
  }

  const changed = await applyGritQL(
    tree,
    versionsFilePath,
    versionEntryRewrite(entry),
  );

  if (!changed) {
    throw new Error(
      `Could not move ${entry.constantName}.${entry.name} from ${entry.oldVersion} to ${entry.newVersion}: the rewrite matched nothing in ${versionsFilePath}. Check that the constant is declared there and still holds that key at that version.`,
    );
  }
};
