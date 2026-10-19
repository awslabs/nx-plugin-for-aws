/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import {
  bindMetaBlock,
  divergedMetaNextStep,
  findMetaBlockShape,
  META_BINDING,
  NESTED_PROTOCOL_META_HEADER,
  pyDynamoDbBasePyPaths,
  TYPED_IMPORT,
  UNTYPED_IMPORT,
  UNTYPED_META_HEADER,
} from '../../../py/dynamodb/base-model-meta.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Bind the `Meta` of the `BaseModel` that py#dynamodb vends in
 * `<module>/entities/base.py` with pynamodb's declared `MetaProtocol` type.
 *
 * Release 1.0.8 vends, and its `py-dynamodb-type-base-model-meta` migration
 * writes, a nested `class Meta(MetaProtocol):`. pynamodb declares
 * `Model.Meta: MetaProtocol`, a mutable attribute, and the nested class
 * narrows it to the class's own type, which ty 0.0.87 reports as
 * `invalid-mutable-override`. This declares the block as
 * `class _Meta(MetaProtocol):` and binds it with `Meta: MetaProtocol = _Meta`.
 * `Meta` is the same class object, so pynamodb's runtime defaults apply as
 * before.
 *
 * A base.py is edited only where its import line and `Meta` block still have
 * the exact shape the generator wrote. One already bound is left alone, as is
 * an untyped `class Meta:` in the generated shape, which
 * `py-dynamodb-type-base-model-meta` converges on the bound shape before this
 * runs. Any other base.py is left untouched and reported via `nextSteps`.
 */

/**
 * Rewrite a base.py still in the 1.0.8 shape. Already bound, untyped and
 * missing files are left alone; a diverged one is reported via nextSteps.
 */
const migrateBasePy = (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): void => {
  if (!tree.exists(filePath)) {
    return;
  }

  const content = tree.read(filePath, 'utf-8') ?? '';
  if (content.includes(META_BINDING)) {
    return; // Already migrated (or user-added).
  }

  if (
    content.includes(UNTYPED_IMPORT) &&
    findMetaBlockShape(content, UNTYPED_META_HEADER)
  ) {
    return; // Left to py-dynamodb-type-base-model-meta.
  }

  const shape = findMetaBlockShape(content, NESTED_PROTOCOL_META_HEADER);
  if (!shape || !content.includes(TYPED_IMPORT)) {
    nextSteps.push(divergedMetaNextStep(filePath));
    return;
  }

  tree.write(
    filePath,
    bindMetaBlock(content, NESTED_PROTOCOL_META_HEADER, shape),
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const filePath of pyDynamoDbBasePyPaths(tree)) {
    migrateBasePy(tree, filePath, nextSteps);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
