/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { collectPythonDependencies } from './python-collector';

describe('python collector', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-collect-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeDist = (
    venv: string,
    distName: string,
    metadata: string,
  ): void => {
    const distPath = join(
      venv,
      'lib',
      'python3.12',
      'site-packages',
      `${distName}.dist-info`,
    );
    mkdirSync(distPath, { recursive: true });
    writeFileSync(join(distPath, 'METADATA'), metadata);
  };

  const writeVenv = (root: string): string => {
    const venv = join(root, '.venv');
    mkdirSync(venv, { recursive: true });
    writeFileSync(join(venv, 'pyvenv.cfg'), 'home = /usr/bin\n');
    return venv;
  };

  it('returns no dependencies when no venv is present', async () => {
    const result = await collectPythonDependencies({ start: dir });
    expect(result).toEqual([]);
  });

  it('reads license expression, license, and classifier headers', async () => {
    const venv = writeVenv(dir);
    writeDist(
      venv,
      'pkg_a-1.0.0',
      [
        'Metadata-Version: 2.4',
        'Name: pkg_a',
        'Version: 1.0.0',
        'License-Expression: MIT',
        '',
      ].join('\n'),
    );
    writeDist(
      venv,
      'pkg_b-2.0.0',
      [
        'Metadata-Version: 2.1',
        'Name: pkg_b',
        'Version: 2.0.0',
        'License: Apache-2.0',
        '',
      ].join('\n'),
    );
    writeDist(
      venv,
      'pkg_c-3.0.0',
      [
        'Metadata-Version: 2.1',
        'Name: pkg_c',
        'Version: 3.0.0',
        'Classifier: License :: OSI Approved :: BSD License',
        '',
      ].join('\n'),
    );

    const result = await collectPythonDependencies({ start: dir });
    const byName = Object.fromEntries(result.map((r) => [r.name, r]));
    expect(byName.pkg_a.rawLicense).toBe('MIT');
    expect(byName.pkg_b.rawLicense).toBe('Apache-2.0');
    expect(byName.pkg_c.rawLicense).toBe('BSD License');
  });

  it('drops lengthy License: bodies (full license text)', async () => {
    const venv = writeVenv(dir);
    writeDist(
      venv,
      'noisy-1.0.0',
      [
        'Metadata-Version: 2.1',
        'Name: noisy',
        'Version: 1.0.0',
        'License: This is a really long license text that goes on and on and definitely exceeds the threshold for a one-line declaration so we should drop it.',
        '',
      ].join('\n'),
    );

    const [dep] = await collectPythonDependencies({ start: dir });
    expect(dep.rawLicense).toBe('');
  });

  it('joins multiple classifiers with ;', async () => {
    const venv = writeVenv(dir);
    writeDist(
      venv,
      'multi-1.0.0',
      [
        'Metadata-Version: 2.1',
        'Name: multi',
        'Version: 1.0.0',
        'Classifier: License :: OSI Approved :: Apache Software License',
        'Classifier: License :: OSI Approved :: BSD License',
        '',
      ].join('\n'),
    );
    const [dep] = await collectPythonDependencies({ start: dir });
    expect(dep.rawLicense).toBe('Apache Software License; BSD License');
  });

  it('deduplicates by name@version', async () => {
    const venv = writeVenv(dir);
    writeDist(
      venv,
      'pkg-1.0.0',
      [
        'Metadata-Version: 2.1',
        'Name: pkg',
        'Version: 1.0.0',
        'License: MIT',
        '',
      ].join('\n'),
    );
    const result = await collectPythonDependencies({ start: dir });
    expect(result.map((r) => r.name)).toEqual(['pkg']);
  });
});
