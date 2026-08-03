/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { applyGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Drop -optimizeDbBeforeStartup from the vended DynamoDB Local container script
 *
 * DynamoDB Local's startup vacuum drops primary key / GSI uniqueness on the
 * underlying sqlite file, letting PutItem/UpdateItem write duplicate rows for
 * the same key.
 *
 * The edit is expressed as a GritQL rewrite so the script is matched on its
 * AST rather than its formatting. The rewrite matches the whole `runArgs`
 * array rather than just the flag, because this GritQL/tree-sitter grammar
 * can't match a partial slice of array elements, and a literal backtick
 * template string breaks matching anywhere it appears alongside other
 * elements - so every templated element (the port/volume args) is matched via
 * a metavariable instead of being spelled out.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   the generator produces and report them via `nextSteps`.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree`.
 */

const START_CONTAINER_FILE = `${PACKAGES_DIR}/${SHARED_SCRIPTS_DIR}/src/dynamodb/start-container.ts`;

const FLAG = "'-optimizeDbBeforeStartup'";

const REMOVE_FLAG_PATTERN = `\`[
    'run',
    ...(containerEngine === 'docker' ? ['--rm'] : []),
    '--name', containerName,
    '-u', 'root',
    '-w', '/home/dynamodblocal',
    $flagP, $portColonPort,
    '-v', $volume,
    '-d', image,
    '-jar', 'DynamoDBLocal.jar',
    '-sharedDb',
    '-dbPath', './data',
    '-port', $portArg,
    ${FLAG},
  ]\` => \`[
    'run',
    ...(containerEngine === 'docker' ? ['--rm'] : []),
    '--name', containerName,
    '-u', 'root',
    '-w', '/home/dynamodblocal',
    $flagP, $portColonPort,
    '-v', $volume,
    '-d', image,
    '-jar', 'DynamoDBLocal.jar',
    '-sharedDb',
    '-dbPath', './data',
    '-port', $portArg,
  ]\``;

const divergedNextStep = `${START_CONTAINER_FILE}: the container script has diverged from the generated shape - left untouched. Manually drop ${FLAG} from the DynamoDB Local container run args - its startup vacuum can drop primary key / GSI uniqueness on the sqlite file, letting PutItem/UpdateItem write duplicate rows for the same key.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(START_CONTAINER_FILE)) {
    return { nextSteps };
  }

  const contents = tree.read(START_CONTAINER_FILE, 'utf-8') ?? '';
  if (!contents.includes(FLAG)) {
    // Already migrated, or doesn't use this shape.
    return { nextSteps };
  }

  const rewrote = await applyGritQL(
    tree,
    START_CONTAINER_FILE,
    REMOVE_FLAG_PATTERN,
  );

  if (!rewrote) {
    nextSteps.push(divergedNextStep);
    return { nextSteps };
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
