/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as path from 'node:path';
import type { Root } from 'mdast';
import {
  extractFrontmatter,
  readEstreeAttr,
  walkJsx,
} from '../../../packages/nx-plugin/src/mcp-server/mdx-ast';
import {
  parseWhenExpression,
  type Predicate,
} from '../../../packages/nx-plugin/src/mcp-server/option-filter';
import {
  createSchemaLookup,
  type GeneratorSchema,
} from '../../../packages/nx-plugin/src/mcp-server/schema-registry';

/**
 * Remark plugin that validates every <OptionFilter when> predicate against
 * the schema of the generator named in the page's frontmatter. Snippets
 * (shared across generators, no `generator:` field) are skipped.
 *
 * Build fails on:
 *   - unknown generator id
 *   - OptionFilter key not in the schema
 *   - OptionFilter value not in the schema enum
 */

const GENERATORS_JSON = path.resolve(
  import.meta.dirname,
  '../../../packages/nx-plugin/generators.json',
);

const loadSchema = createSchemaLookup(GENERATORS_JSON);
const loadSchemaSafely = (generatorId: string): GeneratorSchema => {
  try {
    return loadSchema(generatorId);
  } catch (err) {
    throw new Error(
      `[remark-option-filter] ${(err as Error).message}. Check the 'generator' frontmatter field.`,
    );
  }
};

const collectOptionFilterPredicates = (tree: Root): Predicate[] => {
  const predicates: Predicate[] = [];
  walkJsx(tree, (node) => {
    if (node.name !== 'OptionFilter') return;
    const estree = readEstreeAttr(node, 'when');
    if (!estree) return;
    try {
      predicates.push(parseWhenExpression(estree as never));
    } catch (err) {
      throw new Error(`[remark-option-filter] ${(err as Error).message}`);
    }
  });
  return predicates;
};

const remarkOptionFilter = () => {
  return (
    tree: Root,
    file: {
      path?: string;
      data?: any;
    },
  ) => {
    const pagePath = file?.path ?? '(unknown)';
    const fromAstro = file?.data?.astro?.frontmatter?.generator;
    const fromTree = extractFrontmatter(tree).data.generator;
    const generatorId =
      typeof fromAstro === 'string'
        ? fromAstro
        : typeof fromTree === 'string'
          ? fromTree
          : undefined;
    if (!generatorId) return;

    let predicates: Predicate[];
    try {
      predicates = collectOptionFilterPredicates(tree);
    } catch (err) {
      throw new Error(
        `[remark-option-filter] ${pagePath}: ${(err as Error).message}`,
      );
    }
    if (predicates.length === 0) return;

    const props = loadSchemaSafely(generatorId).properties ?? {};
    for (const predicate of predicates) {
      for (const [key, values] of Object.entries(predicate)) {
        const prop = props[key];
        if (!prop) {
          throw new Error(
            `[remark-option-filter] ${pagePath}: OptionFilter references unknown option '${key}' for generator '${generatorId}'. Known options: ${Object.keys(props).join(', ')}`,
          );
        }
        if (!Array.isArray(prop.enum) || prop.enum.length === 0) {
          throw new Error(
            `[remark-option-filter] ${pagePath}: OptionFilter references option '${key}' for generator '${generatorId}', but that option is not an enum — only enum options can be filtered on.`,
          );
        }
        const enumStrs = prop.enum.map((v) => String(v));
        for (const v of values) {
          if (!enumStrs.includes(v)) {
            throw new Error(
              `[remark-option-filter] ${pagePath}: OptionFilter uses value '${v}' for option '${key}' of generator '${generatorId}', but the schema enum is [${enumStrs.join(', ')}]`,
            );
          }
        }
      }
    }
  };
};

export default remarkOptionFilter;
