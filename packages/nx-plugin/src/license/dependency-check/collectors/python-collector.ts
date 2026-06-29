/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import TOML from '@iarna/toml';
import { execSync } from 'child_process';
import fastGlob from 'fast-glob';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { uvxCommand } from '../../../utils/py';

export interface PythonDependency {
  name: string;
  version: string;
  rawLicense: string;
}

export interface PythonCollectorOptions {
  start: string;
  excludePackages?: string[];
}

interface PipLicensesEntry {
  Name: string;
  Version: string;
  'License-Expression': string;
  'License-Metadata': string;
  'License-Classifier': string;
}

const isUsable = (value: string | undefined): value is string =>
  !!value && value !== 'UNKNOWN';

// Priority: License-Expression (PEP 639) > License-Metadata (legacy) > License-Classifier (deprecated classifiers)
const pickLicense = (entry: PipLicensesEntry): string => {
  if (isUsable(entry['License-Expression'])) return entry['License-Expression'];
  if (isUsable(entry['License-Metadata'])) return entry['License-Metadata'];
  if (isUsable(entry['License-Classifier'])) return entry['License-Classifier'];
  return '';
};

/**
 * Discover Python project names in the workspace (from pyproject.toml files)
 * so they can be excluded from the license check.
 */
export const findWorkspacePyProjectNames = async (
  start: string,
): Promise<string[]> => {
  const tomlFiles = await fastGlob(['**/pyproject.toml'], {
    cwd: start,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**', '**/dist/**'],
    deep: 4,
    suppressErrors: true,
  });
  const names: string[] = [];
  for (const tomlFile of tomlFiles) {
    try {
      const content = readFileSync(join(start, tomlFile), 'utf-8');
      const parsed = TOML.parse(content);
      const name = (parsed.project as TOML.JsonMap | undefined)?.name;
      if (typeof name === 'string') names.push(name);
    } catch {
      // skip unreadable or malformed files
    }
  }
  return names;
};

const findVenvPythons = async (start: string): Promise<string[]> => {
  const patterns = [
    '**/.venv/bin/python',
    '**/venv/bin/python',
    '**/.venv/Scripts/python.exe',
    '**/venv/Scripts/python.exe',
  ];

  const candidates = await fastGlob(patterns, {
    cwd: start,
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

  const pythons = candidates.map((c) => join(start, c));

  if (process.env.UV_PROJECT_ENVIRONMENT) {
    const envPython = join(
      process.env.UV_PROJECT_ENVIRONMENT,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    if (existsSync(envPython)) {
      pythons.push(envPython);
    }
  }

  return pythons.filter((p) => existsSync(p));
};

/**
 * Collect Python dependency licenses by invoking `uvx pip-licenses` against
 * each discovered virtual environment.
 */
export const collectPythonDependencies = async (
  options: PythonCollectorOptions,
): Promise<PythonDependency[]> => {
  const pythons = await findVenvPythons(options.start);
  if (pythons.length === 0) return [];

  const seen = new Map<string, PythonDependency>();
  const ignoreFlag = options.excludePackages?.length
    ? ` --ignore-packages ${options.excludePackages.join(' ')}`
    : '';
  const cmd = uvxCommand(
    'pip-licenses',
    `--format json --from all${ignoreFlag}`,
  );

  for (const python of pythons) {
    try {
      const output = execSync(`${cmd} --python ${python}`, {
        cwd: options.start,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60_000,
      });

      const entries: PipLicensesEntry[] = JSON.parse(output);
      for (const entry of entries) {
        const key = `${entry.Name}@${entry.Version}`;
        if (seen.has(key)) continue;
        seen.set(key, {
          name: entry.Name,
          version: entry.Version,
          rawLicense: pickLicense(entry),
        });
      }
    } catch {
      // If pip-licenses fails for this venv, skip it
    }
  }

  return Array.from(seen.values());
};
