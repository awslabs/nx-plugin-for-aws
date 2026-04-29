/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import GeneratorsJson from '../../generators.json';
import * as path from 'path';

/**
 * A single guide page reference. A plain string is the common case — the
 * filename (minus `.mdx`) under `docs/src/content/docs/en/guides/`.
 *
 * An object form is used when the generator has many variant-specific guide
 * pages (e.g. the `connection` generator) and we want the MCP server to drop
 * pages that don't apply to the agent's supplied `options`. The `when`
 * predicate matches the same shape used by `<OptionFilter when={{…}}>`:
 * multiple keys are ANDed, array values are ORed.
 */
export type GuidePageRef =
  | string
  | {
      readonly page: string;
      readonly when?: Readonly<Record<string, string | readonly string[]>>;
    };

/**
 * Extra filterable options surfaced by the MCP `generator-guide` tool that
 * aren't backed by the generator's own JSON schema (e.g. `sourceType` /
 * `targetType` for the connection generator). The values here drive the
 * "Filterable options" report the tool prepends to each response, so agents
 * know what keys to pass in the `options` argument to narrow the guide.
 */
export interface ExtraFilterableOption {
  readonly enum: readonly string[];
  readonly description?: string;
}

export interface GeneratorInfo {
  readonly id: string;
  readonly metric: string;
  readonly resolvedFactoryPath: string;
  readonly resolvedSchemaPath: string;
  readonly hidden?: boolean;
  readonly description: string;
  readonly guidePages?: readonly GuidePageRef[];
  readonly extraFilterableOptions?: Readonly<
    Record<string, ExtraFilterableOption>
  >;
}

/**
 * Alias for GeneratorInfo used by MCP server and generators
 */
export type NxGeneratorInfo = GeneratorInfo;

/**
 * Build the list of generator info, resolving schema/factory paths relative to the given base directory.
 */
export const buildGeneratorInfoList = (baseDir: string): GeneratorInfo[] =>
  Object.entries((GeneratorsJson as Record<string, any>).generators).map(
    ([id, info]: [string, any]) => ({
      id,
      metric: info.metric,
      resolvedFactoryPath: path.resolve(baseDir, info.factory),
      resolvedSchemaPath: path.resolve(baseDir, info.schema),
      description: info.description,
      ...('hidden' in info && info.hidden ? { hidden: info.hidden } : {}),
      ...('guidePages' in info && info.guidePages
        ? { guidePages: info.guidePages }
        : {}),
      ...('extraFilterableOptions' in info && info.extraFilterableOptions
        ? { extraFilterableOptions: info.extraFilterableOptions }
        : {}),
    }),
  );
