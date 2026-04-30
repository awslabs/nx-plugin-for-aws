/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs';
import path from 'node:path';

/** A JSON-schema property narrowed to the bits we care about. */
interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
}

export interface GeneratorSchema {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

export interface FilterableOption {
  key: string;
  enum: string[];
  default?: string;
  description?: string;
}

interface GeneratorsJson {
  generators: Record<string, { schema: string }>;
}

/**
 * Pull out every enum-valued property as a `FilterableOption`. Shared between
 * the MCP server (deriving options from a generator's schema) and the docs
 * filter bar (mapping user-referenced keys onto their enum values).
 */
export const filterableOptionsFromSchema = (
  schema: GeneratorSchema | undefined,
): FilterableOption[] => {
  const props = schema?.properties ?? {};
  const out: FilterableOption[] = [];
  for (const [key, prop] of Object.entries(props)) {
    if (!Array.isArray(prop.enum) || prop.enum.length === 0) continue;
    out.push({
      key,
      enum: prop.enum.map((v) => String(v)),
      default: prop.default !== undefined ? String(prop.default) : undefined,
      description: prop.description,
    });
  }
  return out;
};

/**
 * Locate the monorepo's `packages/nx-plugin/generators.json` by walking
 * upward from the caller's directory. Used by the docs filter bar and
 * remark-option-filter; the MCP server resolves schema paths per-generator
 * via `NxGeneratorInfo.resolvedSchemaPath` instead.
 */
export const resolveGeneratorsJson = (fromDir: string): string | undefined => {
  let dir = fromDir;
  while (true) {
    const candidate = path.join(
      dir,
      'packages',
      'nx-plugin',
      'generators.json',
    );
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/**
 * Resolve a generator's schema path against a `generators.json` registry,
 * parse the schema file, and cache the result per-process.
 */
export const createSchemaLookup = (generatorsJsonPath: string) => {
  const packageDir = path.dirname(generatorsJsonPath);
  let registry: GeneratorsJson | undefined;
  const cache = new Map<string, GeneratorSchema>();

  const loadRegistry = (): GeneratorsJson => {
    if (!registry) {
      registry = JSON.parse(
        fs.readFileSync(generatorsJsonPath, 'utf-8'),
      ) as GeneratorsJson;
    }
    return registry;
  };

  return (generatorId: string): GeneratorSchema => {
    const cached = cache.get(generatorId);
    if (cached) return cached;
    const entry = loadRegistry().generators[generatorId];
    if (!entry) {
      throw new Error(`Unknown generator id '${generatorId}'`);
    }
    const schema = JSON.parse(
      fs.readFileSync(path.resolve(packageDir, entry.schema), 'utf-8'),
    ) as GeneratorSchema;
    cache.set(generatorId, schema);
    return schema;
  };
};
