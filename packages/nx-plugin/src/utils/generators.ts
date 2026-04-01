/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import GeneratorsJson from '../../generators.json';
import * as path from 'path';

export interface GeneratorInfo {
  readonly id: string;
  readonly metric: string;
  readonly resolvedFactoryPath: string;
  readonly resolvedSchemaPath: string;
  readonly hidden?: boolean;
  readonly description: string;
  readonly guidePages?: string[];
}

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
    }),
  );
