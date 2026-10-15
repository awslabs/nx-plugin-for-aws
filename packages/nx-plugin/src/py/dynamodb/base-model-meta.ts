/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjects, joinPathFragments, type Tree } from '@nx/devkit';
import { PY_DYNAMODB_GENERATOR_INFO } from './generator.js';

/**
 * The shapes of the `BaseModel` Meta block py#dynamodb has vended in
 * `<module>/entities/base.py`, shared by the migrations that carry an existing
 * base.py to the shape the generator writes today.
 */

/** The pynamodb.models import of a base.py whose Meta is untyped. */
export const UNTYPED_IMPORT = '\nfrom pynamodb.models import Model\n';

/** The pynamodb.models import of a base.py whose Meta is typed. */
export const TYPED_IMPORT =
  '\nfrom pynamodb.models import MetaProtocol, Model\n';

/** A nested Meta that types none of pynamodb's `MetaProtocol` members. */
export const UNTYPED_META_HEADER = '    class Meta:\n';

/** A nested Meta that subclasses `MetaProtocol` but narrows the mutable `Meta`. */
export const NESTED_PROTOCOL_META_HEADER = '    class Meta(MetaProtocol):\n';

/** The block the generator writes today, bound to `Meta` by `META_BINDING`. */
export const BOUND_META_HEADER = '    class _Meta(MetaProtocol):\n';

/** Binds `Meta` to the block while keeping pynamodb's declared type. */
export const META_BINDING = '    Meta: MetaProtocol = _Meta\n';

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

/** One way the generator has written the block's body. */
export interface MetaBlockShape {
  readonly helper: string;
  readonly quote: string;
}

/** Every shape of the block's body the generator has written. */
export const META_BLOCK_SHAPES: readonly MetaBlockShape[] =
  LOCAL_DEV_HELPERS.flatMap((helper) =>
    QUOTES.map((quote) => ({ helper, quote })),
  );

/** The vended `BaseModel` Meta block, up to the blank line that ends it. */
export const metaBlock = (
  header: string,
  { helper, quote }: MetaBlockShape,
  binding = '',
): string =>
  `${header}        table_name: str
        region = os.environ.get("AWS_REGION", ${quote}us-east-1${quote})
        host = f"http://localhost:{${helper}()['port']}" if is_local() else None
        aws_access_key_id = ${quote}UNUSED${quote} if is_local() else None
        aws_secret_access_key = ${quote}UNUSED${quote} if is_local() else None
${binding ? `\n${binding}` : ''}
`;

/** The shape of `content`'s block under `header`, if it has a vended one. */
export const findMetaBlockShape = (
  content: string,
  header: string,
): MetaBlockShape | undefined =>
  META_BLOCK_SHAPES.find((shape) => content.includes(metaBlock(header, shape)));

/** Rewrite the vended block under `header` to the shape vended today. */
export const bindMetaBlock = (
  content: string,
  header: string,
  shape: MetaBlockShape,
): string =>
  content.replace(
    metaBlock(header, shape),
    metaBlock(BOUND_META_HEADER, shape, META_BINDING),
  );

/** The nextSteps entry for a base.py whose Meta or import has diverged. */
export const divergedMetaNextStep = (filePath: string): string =>
  `${filePath}: its BaseModel Meta class or its pynamodb.models import has been customised, so it was left unchanged. If \`ty check\` reports invalid-attribute-override or invalid-mutable-override for it, declare the class as \`class _Meta(MetaProtocol):\` followed by \`Meta: MetaProtocol = _Meta\`, importing MetaProtocol from pynamodb.models.`;

/** The base.py path of every py#dynamodb project, whether or not it exists. */
export const pyDynamoDbBasePyPaths = (tree: Tree): string[] =>
  [...getProjects(tree).values()].flatMap((project) => {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    // py#dynamodb writes its package under the project's sourceRoot.
    return generator === PY_DYNAMODB_GENERATOR_INFO.id && project.sourceRoot
      ? [joinPathFragments(project.sourceRoot, 'entities', 'base.py')]
      : [];
  });
