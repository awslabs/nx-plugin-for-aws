/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A generator's options, read off its schema in the order a reader meets them.
 *
 * Shared by the options reference panel and the run-generator command builder, so
 * a generator's options are listed and offered in the same order by both.
 */

/** A JSON-schema property, narrowed to the parts the docs render. */
export interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  'x-priority'?: string;
}

export interface GeneratorSchema {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/** How a value is entered for an option. */
export type OptionControl = 'enum' | 'boolean' | 'number' | 'text';

export interface GeneratorOption {
  key: string;
  control: OptionControl;
  /** The type as documented: `enum` for a fixed set, else the JSON type. */
  type: string;
  /** The values an enum option accepts, in schema order. */
  values: string[];
  default?: string;
  required: boolean;
  description?: string;
}

/**
 * Ordering buckets: what the reader has to supply, then what the generator marks
 * important, then the rest, with anything marked internal last.
 */
const RANKS: Record<string, number> = { important: 1, normal: 2, internal: 3 };
const REQUIRED_RANK = 0;

const isEnum = (property: SchemaProperty) =>
  Array.isArray(property.enum) && property.enum.length > 0;

const controlFor = (property: SchemaProperty): OptionControl => {
  if (isEnum(property)) return 'enum';
  if (property.type === 'boolean') return 'boolean';
  if (property.type === 'number' || property.type === 'integer')
    return 'number';
  return 'text';
};

export const readGeneratorOptions = (
  schema: GeneratorSchema | undefined,
): GeneratorOption[] => {
  const required = new Set(schema?.required ?? []);
  return (
    Object.entries(schema?.properties ?? {})
      .map(([key, property]) => ({
        key,
        control: controlFor(property),
        type: isEnum(property) ? 'enum' : (property.type ?? 'string'),
        values: (property.enum ?? []).map(String),
        default:
          property.default === undefined ? undefined : String(property.default),
        required: required.has(key),
        description: property.description,
        rank: required.has(key)
          ? REQUIRED_RANK
          : (RANKS[property['x-priority'] ?? 'normal'] ?? RANKS.normal),
      }))
      // Stable, so schema order breaks ties within a bucket.
      .sort((a, b) => a.rank - b.rank)
      .map(({ rank: _rank, ...option }) => option)
  );
};
