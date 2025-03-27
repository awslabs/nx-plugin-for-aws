/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import GeneratorsJson from '../../generators.json';
import PackageJson from '../../package.json';
import * as path from 'path';

export interface NxGeneratorInfo {
  readonly id: string;
  readonly metric: string;
  readonly resolvedFactoryPath: string;
}

const GENERATORS: NxGeneratorInfo[] = Object.entries(
  GeneratorsJson.generators,
).map(([id, { metric, factory }]) => ({
  id,
  metric,
  resolvedFactoryPath: path.resolve(__dirname, '..', '..', factory),
}));

/**
 * Return generator information. Call this from a generator method with __filename
 */
export const getGeneratorInfo = (
  generatorFileName: string,
): NxGeneratorInfo => {
  const { dir, name } = path.parse(path.resolve(generatorFileName));
  const resolvedFactoryPath = path.join(dir, name);
  return GENERATORS.find(
    (generatorInfo) =>
      generatorInfo.resolvedFactoryPath === resolvedFactoryPath,
  );
};

export const getPackageVersion = () => {
  return PackageJson.version;
};
