/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  buildScaffoldRecipes,
  type GeneratorSchema,
  type ScaffoldRecipe,
  type SchemaResolver,
  schemaPathOf,
} from './scaffold-catalog.js';

/** Reads schemas from disk, for the plugin and its tests. */
export const nodeSchemaResolver: SchemaResolver = (() => {
  const cache = new Map<string, GeneratorSchema>();
  return (generatorId: string): GeneratorSchema => {
    const cached = cache.get(generatorId);
    if (cached) return cached;
    // This module lives at src/connection/, and the recorded path is relative to
    // the plugin root, so resolve from two levels up.
    const schemaPath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      schemaPathOf(generatorId),
    );
    let schema: GeneratorSchema;
    try {
      schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    } catch (error) {
      throw new Error(
        `Scaffold catalog: could not read the schema for '${generatorId}' at ${schemaPath}: ${error}`,
      );
    }
    cache.set(generatorId, schema);
    return schema;
  };
})();

/** The scaffold recipes, resolved from the schemas on disk. */
export const SCAFFOLD_RECIPES: Readonly<Record<string, ScaffoldRecipe>> =
  buildScaffoldRecipes(nodeSchemaResolver);
