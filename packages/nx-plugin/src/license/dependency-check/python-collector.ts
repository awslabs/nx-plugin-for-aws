/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { glob as fastGlob } from 'fast-glob';

export interface PythonDependency {
  name: string;
  version: string;
  rawLicense: string;
  path?: string;
}

export interface PythonCollectorOptions {
  /** Project root, used to discover .venv directories. */
  start: string;
}

interface ParsedMetadata {
  name?: string;
  version?: string;
  license?: string;
  licenseExpression?: string;
  licenseClassifiers: string[];
  pyProjectMarker?: string;
}

/**
 * Parse a python distribution METADATA file (PEP 566 / RFC 822 style).
 * Body and continuation lines are ignored — only the headers we need.
 */
const parseMetadata = (text: string): ParsedMetadata => {
  const headerEnd = text.indexOf('\n\n');
  const headersBlock = headerEnd === -1 ? text : text.slice(0, headerEnd);
  const meta: ParsedMetadata = { licenseClassifiers: [] };
  for (const rawLine of headersBlock.split('\n')) {
    const colon = rawLine.indexOf(':');
    if (colon === -1) continue;
    const key = rawLine.slice(0, colon).trim().toLowerCase();
    const value = rawLine.slice(colon + 1).trim();
    if (!value) continue;
    if (key === 'name') meta.name = value;
    else if (key === 'version') meta.version = value;
    else if (key === 'license') meta.license = value;
    else if (key === 'license-expression') meta.licenseExpression = value;
    else if (key === 'classifier' && value.startsWith('License ::')) {
      meta.licenseClassifiers.push(value);
    }
  }
  return meta;
};

/**
 * Convert a `License :: ...` classifier into a license name we can match
 * against the allowlist. The trailing component of the classifier is the
 * canonical short name (e.g. "MIT License").
 */
const classifierToLicenseName = (classifier: string): string => {
  const parts = classifier.split('::').map((p) => p.trim());
  return parts[parts.length - 1];
};

const pickLicense = (meta: ParsedMetadata): string => {
  if (meta.licenseExpression) return meta.licenseExpression;
  if (meta.licenseClassifiers.length > 0) {
    const names = meta.licenseClassifiers
      .map(classifierToLicenseName)
      .filter((n) => n && n !== 'OSI Approved')
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (names.length === 1) return names[0];
    if (names.length > 1) return names.join('; ');
  }
  if (meta.license) {
    // Some packages put the entire license body in the License: field.
    // If it contains newlines or is very long, treat as unknown.
    const trimmed = meta.license.trim();
    if (trimmed.includes('\n') || trimmed.length > 120) return '';
    return trimmed;
  }
  return '';
};

const findVenvs = async (start: string): Promise<string[]> => {
  const candidates = await fastGlob(['**/.venv', '**/venv'], {
    cwd: start,
    onlyDirectories: true,
    ignore: [
      '**/node_modules/**',
      '**/.nx/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
    ],
    deep: 6,
    suppressErrors: true,
  });
  const absoluteCandidates = candidates.map((c) => join(start, c));
  if (process.env.UV_PROJECT_ENVIRONMENT) {
    absoluteCandidates.push(process.env.UV_PROJECT_ENVIRONMENT);
  }
  return absoluteCandidates.filter((dir) =>
    existsSync(join(dir, 'pyvenv.cfg')),
  );
};

const findDistInfoDirs = async (venvRoot: string): Promise<string[]> => {
  const matches = await fastGlob(['lib/python*/site-packages/*.dist-info'], {
    cwd: venvRoot,
    onlyDirectories: true,
    suppressErrors: true,
  });
  return matches.map((m) => join(venvRoot, m));
};

/**
 * Walk every .venv under the project root and collect license metadata for
 * every installed distribution. Deduplicates by `name@version`.
 *
 * Returns an empty list when no virtual environments are found — license-check
 * cannot inspect what is not installed.
 */
export const collectPythonDependencies = async (
  options: PythonCollectorOptions,
): Promise<PythonDependency[]> => {
  const venvs = await findVenvs(options.start);
  if (venvs.length === 0) return [];

  const seen = new Map<string, PythonDependency>();

  for (const venv of venvs) {
    const distInfos = await findDistInfoDirs(venv);
    for (const dist of distInfos) {
      const metadataPath = join(dist, 'METADATA');
      if (!existsSync(metadataPath)) continue;
      // Skip workspace-internal packages (installed from local paths)
      const directUrlPath = join(dist, 'direct_url.json');
      if (existsSync(directUrlPath)) {
        try {
          const directUrl = JSON.parse(readFileSync(directUrlPath, 'utf-8'));
          if (directUrl.dir_info !== undefined) continue;
        } catch {
          // ignore parse errors
        }
      }
      let parsed: ParsedMetadata;
      try {
        parsed = parseMetadata(readFileSync(metadataPath, 'utf-8'));
      } catch {
        continue;
      }
      if (!parsed.name || !parsed.version) continue;
      const key = `${parsed.name}@${parsed.version}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        name: parsed.name,
        version: parsed.version,
        rawLicense: pickLicense(parsed),
        path: dist,
      });
    }
  }

  return Array.from(seen.values());
};
