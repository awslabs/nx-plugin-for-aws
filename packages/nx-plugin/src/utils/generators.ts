/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import GeneratorsJson from '../../generators.json' with { type: 'json' };

/**
 * A single entry in `generators.json`.
 */
export interface GeneratorsJsonEntry {
  readonly factory: string;
  readonly schema: string;
  readonly description: string;
  readonly metric: string;
  readonly hidden?: boolean;
  readonly experimental?: boolean;
  readonly guidePages?: readonly string[];
}

/**
 * Typed view of the `generators.json` entries, keyed by generator id, so every
 * consumer that describes a generator reads the same declared shape.
 */
export const generatorsJsonEntries: Readonly<
  Record<string, GeneratorsJsonEntry>
> = (GeneratorsJson as { generators: Record<string, GeneratorsJsonEntry> })
  .generators;

/**
 * Look up a generator's `generators.json` entry by id, returning `undefined`
 * when no generator has that id.
 */
export const findGeneratorsJsonEntry = (
  generatorId: string,
): GeneratorsJsonEntry | undefined => generatorsJsonEntries[generatorId];

export interface GeneratorInfo {
  readonly id: string;
  readonly metric: string;
  readonly resolvedFactoryPath: string;
  readonly resolvedSchemaPath: string;
  readonly hidden?: boolean;
  /**
   * Experimental generators may change without a migration being published to
   * apply the change to an existing workspace. Surfaced as a banner on the
   * generator's guide page and in the MCP server's generator listings.
   */
  readonly experimental?: boolean;
  readonly description: string;
  readonly guidePages?: readonly string[];
}

/**
 * Alias for GeneratorInfo used by MCP server and generators
 */
export type NxGeneratorInfo = GeneratorInfo;

/**
 * Build the list of generator info, resolving schema/factory paths relative to the given base directory.
 */
export const buildGeneratorInfoList = (baseDir: string): GeneratorInfo[] =>
  Object.entries(generatorsJsonEntries).map(([id, info]) => ({
    id,
    metric: info.metric,
    resolvedFactoryPath: path.resolve(baseDir, info.factory),
    resolvedSchemaPath: path.resolve(baseDir, info.schema),
    description: info.description,
    ...(info.hidden ? { hidden: info.hidden } : {}),
    ...(info.experimental ? { experimental: info.experimental } : {}),
    ...(info.guidePages ? { guidePages: info.guidePages } : {}),
  }));

/**
 * Describe a generator for a catalogue listing, marking an experimental
 * generator so a reader knows its output may change without a migration.
 */
export const describeGeneratorForCatalogue = (
  info: Pick<GeneratorsJsonEntry, 'description' | 'experimental'>,
): string =>
  info.experimental ? `${info.description} (experimental)` : info.description;
