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
  pyDynamoDbBasePyPaths,
  TYPED_IMPORT,
  UNTYPED_IMPORT,
  UNTYPED_META_HEADER,
} from '../../../py/dynamodb/base-model-meta.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Type the `Meta` of the `BaseModel` that py#dynamodb vends in
 * `<module>/entities/base.py` as pynamodb's `MetaProtocol`.
 *
 * pynamodb declares `Model.Meta: MetaProtocol`, a mutable attribute. A nested
 * `class Meta:` defines only some of the protocol's members, which ty reports
 * as `invalid-attribute-override`; and any nested `class Meta`, even one
 * subclassing the protocol, declares `Meta` with the narrower type of that
 * class, which ty 0.0.87 reports as `invalid-mutable-override`. So the block is
 * declared as `class _Meta(MetaProtocol):` and bound with
 * `Meta: MetaProtocol = _Meta`, keeping the inherited type. Subclassing the
 * protocol declares every member with the protocol's type; the members it only
 * annotates are not set on the class, so pynamodb's runtime defaults apply as
 * before, and `Meta` is the same class object it was.
 *
 * The generator writes base.py once and keeps the user's copy, so this brings
 * existing workspaces up to date. A base.py is edited only where its import
 * line and `Meta` block still have the exact shape the generator wrote. One
 * that has diverged is left untouched and reported via `nextSteps`.
 */

/**
 * Rewrite a base.py still in the generated shape. Already migrated and missing
 * files are left alone; a diverged one is reported via nextSteps.
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

  const shape = findMetaBlockShape(content, UNTYPED_META_HEADER);
  if (!shape || !content.includes(UNTYPED_IMPORT)) {
    nextSteps.push(divergedMetaNextStep(filePath));
    return;
  }

  tree.write(
    filePath,
    bindMetaBlock(
      content.replace(UNTYPED_IMPORT, TYPED_IMPORT),
      UNTYPED_META_HEADER,
      shape,
    ),
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
