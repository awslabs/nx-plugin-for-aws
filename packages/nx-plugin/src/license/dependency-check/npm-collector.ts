/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import type * as LicenseCheckerType from 'license-checker-rseidelsohn';

/**
 * Resolve license-checker-rseidelsohn relative to either the plugin (in
 * normal installs where pnpm hoists into the consumer's node_modules) or the
 * project under test (covers `pnpm link` and similar local-development setups
 * where the plugin's own dependencies are not in the consumer's tree).
 */
const loadLicenseChecker = (
  projectStart: string,
): typeof LicenseCheckerType => {
  try {
    return require('license-checker-rseidelsohn') as typeof LicenseCheckerType;
  } catch {
    try {
      const pluginRequire = createRequire(join(__dirname, 'package.json'));
      return pluginRequire(
        'license-checker-rseidelsohn',
      ) as typeof LicenseCheckerType;
    } catch {
      const cwdRequire = createRequire(join(projectStart, 'package.json'));
      return cwdRequire(
        'license-checker-rseidelsohn',
      ) as typeof LicenseCheckerType;
    }
  }
};

export interface NpmDependency {
  name: string;
  version: string;
  rawLicense: string;
  /** Path on disk to the package, useful for diagnostic output. */
  path?: string;
}

export interface NpmCollectorOptions {
  /** Project root containing the package.json or project config. */
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

/**
 * Collect every dependency (transitive included) declared by a project's
 * installed node_modules.
 *
 * Returns an empty list if the project has no node_modules — license-check
 * cannot inspect what is not installed, so this is treated as "nothing to
 * verify" rather than a failure. Callers should ensure dependencies are
 * installed before invoking this in CI.
 */
export const collectNpmDependencies = async (
  options: NpmCollectorOptions,
): Promise<NpmDependency[]> => {
  const nodeModules = join(options.start, 'node_modules');
  if (!existsSync(nodeModules)) {
    return [];
  }

  const exclude = new Set<string>();

  // Auto-exclude the project under test itself.
  const projectPackageJson = join(options.start, 'package.json');
  if (existsSync(projectPackageJson)) {
    try {
      const pkg = JSON.parse(readFileSync(projectPackageJson, 'utf-8')) as {
        name?: string;
      };
      if (pkg.name) exclude.add(pkg.name);
    } catch {
      // ignore — collection will continue without an auto-exclusion
    }
  }

  const licenseChecker = loadLicenseChecker(options.start);

  const packages = await new Promise<LicenseCheckerType.ModuleInfos>(
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
