/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync } from 'fs';
import * as licenseChecker from 'license-checker-rseidelsohn';
// license-checker's own license-from-text detection, which it applies to
// packages that declare no license. Reused here so a `SEE LICENSE IN <file>`
// package resolves the same way, rather than through a second implementation.
import { getLicenseTitle } from 'license-checker-rseidelsohn/lib/getLicenseTitle.js';
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

/**
 * A license that names a file instead of a license: the SPDX form
 * `SEE LICENSE IN <file>`, or the `Custom: <file>` license-checker reports it
 * as.
 */
const FILE_REFERENCE_RE = /^(?:custom:|see\s+license\s+in)\s+(.+)$/i;

/**
 * Resolve a license that only names a file into the license that file grants.
 *
 * license-checker reads a package's license file only when the package declares
 * no license, so a package declaring `SEE LICENSE IN LICENSE` is reported as
 * `Custom: LICENSE` and evaluates to UNKNOWN even when the file grants a
 * pre-approved license. Read the file license-checker already located and run
 * its text detection over it, which returns an SPDX id with the trailing `*`
 * marking a license guessed from text.
 *
 * The reference is kept when the file can't be read, or when detection can't
 * name a license, so the dependency is still reported as UNKNOWN.
 */
export const resolveFileReferencedLicense = (
  rawLicense: string,
  licenseFile: string | undefined,
): string => {
  if (!licenseFile || !FILE_REFERENCE_RE.test(rawLicense.trim())) {
    return rawLicense;
  }
  let detected: string | null = null;
  try {
    detected = getLicenseTitle(readFileSync(licenseFile, 'utf-8'));
  } catch {
    return rawLicense;
  }
  if (!detected || detected === 'Undefined' || FILE_REFERENCE_RE.test(detected))
    return rawLicense;
  return detected;
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
      rawLicense: resolveFileReferencedLicense(
        flattenLicense(info.licenses),
        info.licenseFile,
      ),
      path: info.path,
    });
  }
  return out;
};
