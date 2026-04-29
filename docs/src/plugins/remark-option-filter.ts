/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Root } from 'mdast';
import {
  scanOptionFilters,
  type OptionFilterBlock,
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

const visitAll = (
  blocks: OptionFilterBlock[],
  fn: (b: OptionFilterBlock) => void,
) => {
  for (const b of blocks) {
    fn(b);
    visitAll(b.children, fn);
  }
};

const findFrontmatterGenerator = (tree: Root): string | undefined => {
  for (const child of tree.children) {
    if (child.type === 'yaml') {
      const match = /^generator:\s*(.+)$/m.exec(child.value);
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
};

const remarkOptionFilter = () => {
  return (
    tree: Root,
    file: {
      path?: string;
      data?: any;
      value?: string | Buffer;
    },
  ) => {
    const pagePath = file?.path ?? '(unknown)';

    const generatorId: string | undefined =
      file?.data?.astro?.frontmatter?.generator ??
      findFrontmatterGenerator(tree);

    if (!generatorId) return;

    const source =
      typeof file?.value === 'string'
        ? file.value
        : Buffer.isBuffer(file?.value)
          ? file.value.toString('utf-8')
          : '';

    if (!source || !source.includes('<OptionFilter')) return;

    const schema = loadSchema(generatorId);
    const props = schema.properties ?? {};

    let blocks: OptionFilterBlock[];
    try {
      blocks = scanOptionFilters(source);
    } catch (err) {
      throw new Error(
        `[remark-option-filter] ${pagePath}: ${(err as Error).message}`,
      );
    }

    visitAll(blocks, (b) => {
      for (const [key, values] of Object.entries(b.predicate)) {
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
    });
  };
};

export default remarkOptionFilter;
