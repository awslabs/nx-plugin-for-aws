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
import { SMITHY_PROJECT_GENERATOR_INFO } from '../../../smithy/project/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/** The traits the connection generator vends, each named after its OpenAPI key. */
const TRAITS = ['query', 'mutation', 'cursor'] as const;

/**
 * Matches a bare `@specificationExtension` applied to the named structure, with
 * the `@trait` and `@specificationExtension` traits adjacent to the `structure`
 * they annotate. A declaration that already carries an argument does not match.
 */
const bareDeclaration = (trait: string) =>
  new RegExp(
    `(@trait\\s*\\n\\s*@specificationExtension)(\\s*\\n\\s*structure\\s+${trait}\\s*\\{)`,
  );

/**
 * Give each trait in a Smithy model's `extensions.smithy` an explicit
 * `@specificationExtension(as: "...")` alias.
 *
 * Without the alias Smithy derives the OpenAPI key from the trait's shape id and
 * emits a namespace-prefixed key (`x-<namespace>-query`), which the client code
 * generator does not read — so the `@query`, `@mutation` and `@cursor` traits
 * have no effect on the generated client. The alias pins each key to the
 * unprefixed name the generator recognises.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Smithy IDL is not a language GritQL parses, so each edit is anchored to the
 *   exact `@trait` + `@specificationExtension` + `structure <name>` triple the
 *   generator vends.
 * - A declaration that already carries an `as:` argument, or that has diverged
 *   from the vended shape, is left alone and reported via `nextSteps`.
 * - Idempotent: an aliased declaration no longer matches the bare pattern.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [, project] of getProjects(tree)) {
    if (
      ((project.metadata as any) ?? {}).generator !==
      SMITHY_PROJECT_GENERATOR_INFO.id
    ) {
      continue;
    }

    const extensionsPath = joinPathFragments(
      project.sourceRoot ?? joinPathFragments(project.root, 'src'),
      'extensions.smithy',
    );
    if (!tree.exists(extensionsPath)) {
      continue;
    }

    const before = tree.read(extensionsPath, 'utf-8') ?? '';
    let after = before;
    const skipped: string[] = [];

    for (const trait of TRAITS) {
      if (after.includes(`@specificationExtension(as: "x-${trait}")`)) {
        // Already aliased.
        continue;
      }
      const bare = bareDeclaration(trait);
      if (!bare.test(after)) {
        skipped.push(trait);
        continue;
      }
      after = after.replace(bare, `$1(as: "x-${trait}")$2`);
    }

    if (after !== before) {
      tree.write(extensionsPath, after);
    }

    if (skipped.length > 0) {
      nextSteps.push(
        `${extensionsPath}: add ${skipped
          .map((trait) => `\`(as: "x-${trait}")\``)
          .join(
            ', ',
          )} to the \`@specificationExtension\` trait on ${skipped.map((trait) => `\`${trait}\``).join(', ')}, so Smithy emits the ${skipped.map((trait) => `\`x-${trait}\``).join(', ')} OpenAPI ${skipped.length === 1 ? 'key' : 'keys'} the client generator reads.`,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
