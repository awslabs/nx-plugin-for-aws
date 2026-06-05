/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync } from 'fs';
import * as licenseChecker from 'license-checker-rseidelsohn';
import { join } from 'path';

export interface NpmDependency {
  name: string;
  version: string;
  rawLicense: string;
  path?: string;
}

export interface NpmCollectorOptions {
  start: string;
}

const NAME_VERSION_RE = /^(@?[^@]+)@(.+)$/;

const splitNameVersion = (
  identifier: string,
): { name: string; version: string } => {
  const match = identifier.match(NAME_VERSION_RE);
  if (!match) {
    return { name: identifier, version: '0.0.0' };
  }
  return { name: match[1], version: match[2] };
};

const flattenLicense = (raw: string | string[] | undefined | null): string => {
  if (!raw) return '';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return '';
    if (raw.length === 1) return raw[0];
    return `(${raw.join(' OR ')})`;
  }
  return raw;
};

export const collectNpmDependencies = async (
  options: NpmCollectorOptions,
): Promise<NpmDependency[]> => {
  const nodeModules = join(options.start, 'node_modules');
  if (!existsSync(nodeModules)) {
    return [];
  }

  const exclude = new Set<string>();

  const projectPackageJson = join(options.start, 'package.json');
  if (existsSync(projectPackageJson)) {
    try {
      const pkg = JSON.parse(readFileSync(projectPackageJson, 'utf-8')) as {
        name?: string;
      };
      if (pkg.name) exclude.add(pkg.name);
    } catch {
      // ignore
    }
  }

  const packages = await new Promise<licenseChecker.ModuleInfos>(
    (resolve, reject) => {
      licenseChecker.init(
        {
          start: options.start,
          excludePrivatePackages: true,
        },
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    },
  );

  const out: NpmDependency[] = [];
  for (const [identifier, info] of Object.entries(packages)) {
    const { name, version } = splitNameVersion(identifier);
    if (exclude.has(name)) continue;
    out.push({
      name,
      version,
      rawLicense: flattenLicense(info.licenses),
      path: info.path,
    });
  }
  return out;
};
