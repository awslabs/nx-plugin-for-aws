/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { PY_DYNAMODB_GENERATOR_INFO } from '../../../py/dynamodb/generator.js';
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

const OLD_IMPORT = '\nfrom pynamodb.models import Model\n';
const NEW_IMPORT = '\nfrom pynamodb.models import MetaProtocol, Model\n';

const OLD_META_HEADER = '    class Meta:\n';
const NEW_META_HEADER = '    class _Meta(MetaProtocol):\n';

/** Binds `Meta` to the block while keeping pynamodb's declared type. */
const META_BINDING = '    Meta: MetaProtocol = _Meta\n';

/**
 * The helper the vended `host` line reads the local port through. Workspaces
 * generated before the serve-local -> local-dev rename use `_serve_local`.
 */
const LOCAL_DEV_HELPERS = ['_local_dev', '_serve_local'];

/**
 * The quote the block's string literals use: the template's single quotes, or
 * the double quotes `ruff format` rewrites them to.
 */
const QUOTES = ['"', "'"];

/** The vended `BaseModel` Meta block, up to the blank line that ends it. */
const metaBlock = (
  header: string,
  localDevHelper: string,
  quote: string,
  binding = '',
): string =>
  `${header}        table_name: str
        region = os.environ.get("AWS_REGION", ${quote}us-east-1${quote})
        host = f"http://localhost:{${localDevHelper}()['port']}" if is_local() else None
        aws_access_key_id = ${quote}UNUSED${quote} if is_local() else None
        aws_secret_access_key = ${quote}UNUSED${quote} if is_local() else None
${binding ? `\n${binding}` : ''}
`;

/** Every shape of the block the generator has written. */
const OLD_META_SHAPES = LOCAL_DEV_HELPERS.flatMap((helper) =>
  QUOTES.map((quote) => ({ helper, quote })),
);

const divergedNextStep = (filePath: string): string =>
  `${filePath}: its BaseModel Meta class or its pynamodb.models import has been customised, so it was left unchanged. If \`ty check\` reports invalid-attribute-override or invalid-mutable-override for it, declare the class as \`class _Meta(MetaProtocol):\` followed by \`Meta: MetaProtocol = _Meta\`, importing MetaProtocol from pynamodb.models.`;

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

  const shape = OLD_META_SHAPES.find(({ helper, quote }) =>
    content.includes(metaBlock(OLD_META_HEADER, helper, quote)),
  );
  if (!shape || !content.includes(OLD_IMPORT)) {
    nextSteps.push(divergedNextStep(filePath));
    return;
  }

  tree.write(
    filePath,
    content
      .replace(OLD_IMPORT, NEW_IMPORT)
      .replace(
        metaBlock(OLD_META_HEADER, shape.helper, shape.quote),
        metaBlock(NEW_META_HEADER, shape.helper, shape.quote, META_BINDING),
      ),
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    // py#dynamodb writes its package under the project's sourceRoot.
    if (generator !== PY_DYNAMODB_GENERATOR_INFO.id || !project.sourceRoot) {
      continue;
    }
    migrateBasePy(
      tree,
      joinPathFragments(project.sourceRoot, 'entities', 'base.py'),
      nextSteps,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
