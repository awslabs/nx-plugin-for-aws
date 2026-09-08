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
  /**
   * The option values this option applies under, e.g. `{ "framework": "smithy" }`
   * on an option only the Smithy framework takes. AND across keys, OR within a
   * key, and a key the reader hasn't chosen a value for has no opinion.
   */
  'x-when'?: Record<string, string | string[]>;
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
  /** Normalised `x-when`: the values this option applies under. */
  when?: Record<string, string[]>;
}

/**
 * Ordering buckets: what the reader has to supply, then what the generator marks
 * important, then the rest, with anything marked internal last.
 */
const RANKS: Record<string, number> = { important: 1, normal: 2, internal: 3 };
const REQUIRED_RANK = 0;

const isEnum = (property: SchemaProperty) =>
  Array.isArray(property.enum) && property.enum.length > 0;

/** Normalise `x-when` so a single value and a list of them read the same. */
const whenOf = (
  property: SchemaProperty,
): Record<string, string[]> | undefined => {
  const when = property['x-when'];
  if (!when) return undefined;
  return Object.fromEntries(
    Object.entries(when).map(([key, value]) => [
      key,
      (Array.isArray(value) ? value : [value]).map(String),
    ]),
  );
};

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
        when: whenOf(property),
        rank: required.has(key)
          ? REQUIRED_RANK
          : (RANKS[property['x-priority'] ?? 'normal'] ?? RANKS.normal),
      }))
      // Stable, so schema order breaks ties within a bucket.
      .sort((a, b) => a.rank - b.rank)
      .map(({ rank: _rank, ...option }) => option)
  );
};

/**
 * Whether an option applies given the values chosen so far.
 *
 * Mirrors `<OptionFilter when>`: AND across keys, OR within a key, and a key with
 * no value chosen doesn't rule the option out — the generator would prompt for it.
 */
export const isApplicable = (
  option: Pick<GeneratorOption, 'when'>,
  values: Record<string, string>,
): boolean => {
  if (!option.when) return true;
  for (const [key, allowed] of Object.entries(option.when)) {
    const value = values[key];
    if (value === undefined || value === '') continue;
    if (!allowed.includes(value)) return false;
  }
  return true;
};

/** `key = a | b` for the values an option applies under, for a short label. */
export const describeWhen = (when: Record<string, string[]>): string =>
  Object.entries(when)
    .map(([key, values]) => `${key} = ${values.join(' | ')}`)
    .join(', ');
