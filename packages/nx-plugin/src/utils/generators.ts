/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import GeneratorsJson from '../../generators.json' with { type: 'json' };

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
  Object.entries((GeneratorsJson as Record<string, any>).generators).map(
    ([id, info]: [string, any]) => ({
      id,
      metric: info.metric,
      resolvedFactoryPath: path.resolve(baseDir, info.factory),
      resolvedSchemaPath: path.resolve(baseDir, info.schema),
      description: info.description,
      ...('hidden' in info && info.hidden ? { hidden: info.hidden } : {}),
      ...('experimental' in info && info.experimental
        ? { experimental: info.experimental }
        : {}),
      ...('guidePages' in info && info.guidePages
        ? { guidePages: info.guidePages }
        : {}),
    }),
  );
