/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  default: { execSync: mockExecSync },
  execSync: mockExecSync,
}));

// Import after mock is set up
const { collectPythonDependencies } = await import('./python-collector');

describe('python collector', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'py-collect-'));
    mockExecSync.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeVenv = (root: string): void => {
    const binDir = join(root, '.venv', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'python'), '#!/usr/bin/env python3\n');
  };

  it('returns no dependencies when no venv is present', async () => {
    const result = await collectPythonDependencies({ start: dir });
    expect(result).toEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('parses pip-licenses JSON output preferring License-Expression', async () => {
    writeVenv(dir);
    mockExecSync.mockReturnValue(
      JSON.stringify([
        {
          Name: 'requests',
          Version: '2.31.0',
          'License-Expression': 'UNKNOWN',
          'License-Metadata': 'Apache-2.0',
          'License-Classifier': 'Apache Software License',
        },
        {
          Name: 'urllib3',
          Version: '2.0.4',
          'License-Expression': 'MIT',
          'License-Metadata': 'UNKNOWN',
          'License-Classifier': 'UNKNOWN',
        },
      ]),
    );

    const result = await collectPythonDependencies({ start: dir });
    expect(result).toEqual([
      { name: 'requests', version: '2.31.0', rawLicense: 'Apache-2.0' },
      { name: 'urllib3', version: '2.0.4', rawLicense: 'MIT' },
    ]);
  });

  it('treats all-UNKNOWN licenses as empty string', async () => {
    writeVenv(dir);
    mockExecSync.mockReturnValue(
      JSON.stringify([
        {
          Name: 'mystery',
          Version: '1.0.0',
          'License-Expression': 'UNKNOWN',
          'License-Metadata': 'UNKNOWN',
          'License-Classifier': 'UNKNOWN',
        },
      ]),
    );

    const [dep] = await collectPythonDependencies({ start: dir });
    expect(dep.rawLicense).toBe('');
  });

  it('deduplicates by name@version across venvs', async () => {
    writeVenv(dir);
    mkdirSync(join(dir, 'packages/sub/.venv/bin'), { recursive: true });
    writeFileSync(join(dir, 'packages/sub/.venv/bin/python'), '');

    mockExecSync.mockReturnValue(
      JSON.stringify([
        {
          Name: 'requests',
          Version: '2.31.0',
          'License-Expression': 'Apache-2.0',
          'License-Metadata': 'UNKNOWN',
          'License-Classifier': 'UNKNOWN',
        },
      ]),
    );

    const result = await collectPythonDependencies({ start: dir });
    expect(result.filter((r) => r.name === 'requests')).toHaveLength(1);
  });

  it('skips venvs where pip-licenses fails', async () => {
    writeVenv(dir);
    mockExecSync.mockImplementation(() => {
      throw new Error('pip-licenses not found');
    });

    const result = await collectPythonDependencies({ start: dir });
    expect(result).toEqual([]);
  });
});
