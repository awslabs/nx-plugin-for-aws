/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SUPPORTED_CONNECTIONS } from './generator';

/**
 * A connection type is either a project-level type (e.g. `react`, `ts#rdb`) or a
 * component generator id (e.g. `ts#agent`, `py#mcp-server`) that participates in
 * {@link SUPPORTED_CONNECTIONS}. Each maps to the schema of the generator that
 * vends it, whose enum properties are the dimensions a connection may depend on.
 */
export type ConnectionType = (typeof SUPPORTED_CONNECTIONS)[number][
  | 'source'
  | 'target'];

/**
 * The schema that vends each connection type, relative to this directory. The
 * enum properties of these schemas are the source of truth for the dimensions
 * crossed into the permutation cartesian — adding an enum value here grows the
 * cartesian and trips the permutation guard until the new value is classified.
 */
const CONNECTION_TYPE_SCHEMAS = {
  'ts#trpc-api': '../trpc/backend/schema.json',
  'py#fast-api': '../py/fast-api/schema.json',
  react: '../ts/website/app/schema.json',
  smithy: '../smithy/ts/api/schema.json',
  'ts#rdb': '../ts/rdb/schema.json',
  'ts#dynamodb': '../ts/dynamodb/schema.json',
  'py#dynamodb': '../py/dynamodb/schema.json',
  'agentcore-gateway': '../agentcore-gateway/schema.json',
  'ts#agent': '../ts/agent/schema.json',
  'py#agent': '../py/agent/schema.json',
  'ts#mcp-server': '../ts/mcp-server/schema.json',
  'py#mcp-server': '../py/mcp-server/schema.json',
} as const satisfies Record<ConnectionType, string>;

/** A connection type's enum dimensions, keyed by property name. */
export type Dimensions = Record<string, readonly string[]>;

/** A concrete choice of one value per dimension. */
export type DimensionValues = Record<string, string>;

/**
 * Read the enum dimensions for a connection type live from its schema. Every
 * `enum` property is treated as a dimension — no judgement about which enums
 * affect a connection, so the cartesian is exhaustive by construction.
 */
export const readConnectionTypeDimensions = (
  type: ConnectionType,
): Dimensions => {
  const schemaPath = join(__dirname, CONNECTION_TYPE_SCHEMAS[type]);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const properties: Record<string, { enum?: string[] }> =
    schema.properties ?? {};
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, prop]) => Array.isArray(prop.enum))
      .map(([name, prop]) => [name, prop.enum as string[]]),
  );
};

/** The default value of each dimension, read live from the schema. */
export const readConnectionTypeDimensionDefaults = (
  type: ConnectionType,
): DimensionValues => {
  const schemaPath = join(__dirname, CONNECTION_TYPE_SCHEMAS[type]);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const properties: Record<string, { enum?: string[]; default?: string }> =
    schema.properties ?? {};
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, prop]) => Array.isArray(prop.enum))
      .map(([name, prop]) => [
        name,
        prop.default ?? (prop.enum as string[])[0],
      ]),
  );
};

/**
 * The full cartesian product of a connection type's dimensions. With all enums
 * crossed this can be large, which is fine for the (pure, fast) exhaustiveness
 * check; behavioural tiers sample from it via {@link sampleDimensionValues}.
 */
export const enumerateDimensionValues = (
  dimensions: Dimensions,
): DimensionValues[] => {
  const names = Object.keys(dimensions);
  return names.reduce<DimensionValues[]>(
    (acc, name) =>
      acc.flatMap((partial) =>
        dimensions[name].map((value) => ({ ...partial, [name]: value })),
      ),
    [{}],
  );
};

/**
 * A bounded, representative sample of a connection type's cartesian: the
 * all-defaults cell plus, for each dimension, one cell per enum value with every
 * other dimension at its default. Linear in the number of enum values, and every
 * value appears at least once — enough for behavioural tiers that must actually
 * generate or build each cell.
 */
export const sampleDimensionValues = (
  dimensions: Dimensions,
  defaults: DimensionValues,
): DimensionValues[] => {
  const seen = new Set<string>();
  const samples: DimensionValues[] = [];
  const add = (values: DimensionValues) => {
    const key = JSON.stringify(values);
    if (!seen.has(key)) {
      seen.add(key);
      samples.push(values);
    }
  };
  add(defaults);
  for (const [name, values] of Object.entries(dimensions)) {
    for (const value of values) {
      add({ ...defaults, [name]: value });
    }
  }
  return samples;
};
