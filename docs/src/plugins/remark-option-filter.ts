/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Root, RootContent } from 'mdast';
import type {
  MdxJsxAttribute,
  MdxJsxAttributeValueExpression,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from 'mdast-util-mdx-jsx';
import yaml from 'js-yaml';
import {
  parseWhenExpression,
  type Predicate,
} from '../../../packages/nx-plugin/src/mcp-server/option-filter';

/**
 * Remark plugin that validates every <OptionFilter> block on an MDX page
 * against the schema of the generator named in the page's frontmatter.
 *
 * Build fails when:
 *   - `generator:` points to an unknown generator id
 *   - an OptionFilter references an option key not in the schema
 *   - an OptionFilter references a value not in the schema's enum
 *
 * The filter bar itself is rendered by markdown-content.astro — this plugin
 * intentionally only validates, keeping AST mutation out of the build path.
 *
 * Snippets (files under `docs/src/content/docs/*\/snippets/`) do not carry
 * a `generator:` field — they are shared across generators — so they are
 * not validated here. OptionFilter blocks inside snippets still filter
 * correctly at runtime (the filter bar's querySelectorAll covers them) and
 * the MCP server recursively post-processes snippet content with the same
 * `options`, so downstream behaviour is unchanged.
 */

interface GeneratorsJsonShape {
  generators: Record<string, { schema: string }>;
}

interface GeneratorSchema {
  properties?: Record<
    string,
    { type?: string; enum?: unknown[]; default?: unknown; description?: string }
  >;
}

const GENERATORS_JSON = path.resolve(
  import.meta.dirname,
  '../../../packages/nx-plugin/generators.json',
);
const PACKAGE_DIR = path.dirname(GENERATORS_JSON);

let cachedRegistry: GeneratorsJsonShape | undefined;
const loadRegistry = (): GeneratorsJsonShape => {
  if (!cachedRegistry) {
    cachedRegistry = JSON.parse(
      fs.readFileSync(GENERATORS_JSON, 'utf-8'),
    ) as GeneratorsJsonShape;
  }
  return cachedRegistry;
};

const schemaCache = new Map<string, GeneratorSchema>();
const loadSchema = (generatorId: string): GeneratorSchema => {
  const cached = schemaCache.get(generatorId);
  if (cached) return cached;
  const registry = loadRegistry();
  const entry = registry.generators[generatorId];
  if (!entry) {
    throw new Error(
      `[remark-option-filter] Unknown generator id '${generatorId}'. Check the 'generator' frontmatter field.`,
    );
  }
  const schemaPath = path.resolve(PACKAGE_DIR, entry.schema);
  const schema = JSON.parse(
    fs.readFileSync(schemaPath, 'utf-8'),
  ) as GeneratorSchema;
  schemaCache.set(generatorId, schema);
  return schema;
};

const findFrontmatterGenerator = (tree: Root): string | undefined => {
  for (const child of tree.children) {
    if (child.type !== 'yaml') continue;
    let parsed: unknown;
    try {
      parsed = yaml.load(child.value);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { generator?: unknown }).generator === 'string'
    ) {
      return (parsed as { generator: string }).generator;
    }
  }
  return undefined;
};

const isJsxElement = (
  node: RootContent,
): node is MdxJsxFlowElement | MdxJsxTextElement =>
  node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';

const readEstreeAttr = (
  node: MdxJsxFlowElement | MdxJsxTextElement,
  name: string,
): unknown | undefined => {
  const attr = node.attributes.find(
    (a): a is MdxJsxAttribute =>
      a.type === 'mdxJsxAttribute' && a.name === name,
  );
  if (!attr) return undefined;
  if (typeof attr.value === 'object' && attr.value !== null) {
    return (attr.value as MdxJsxAttributeValueExpression).data?.estree;
  }
  return undefined;
};

const collectOptionFilterPredicates = (tree: Root): Predicate[] => {
  const predicates: Predicate[] = [];
  const walk = (parent: Root | MdxJsxFlowElement | MdxJsxTextElement): void => {
    const children = parent.children as RootContent[];
    for (const child of children) {
      if (!isJsxElement(child)) continue;
      if (child.name === 'OptionFilter') {
        const estree = readEstreeAttr(child, 'when');
        if (estree) {
          try {
            predicates.push(parseWhenExpression(estree as never));
          } catch (err) {
            throw new Error(`[remark-option-filter] ${(err as Error).message}`);
          }
        }
      }
      walk(child);
    }
  };
  walk(tree);
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

    const generatorId: string | undefined =
      file?.data?.astro?.frontmatter?.generator ??
      findFrontmatterGenerator(tree);

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

    const schema = loadSchema(generatorId);
    const props = schema.properties ?? {};

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
