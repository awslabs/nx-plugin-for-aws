/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  default: { execSync: mockExecSync },
  execSync: mockExecSync,
}));

// Import after mock is set up
const { collectPythonDependencies, findWorkspacePyProjectNames } = await import(
  './python-collector.js'
);

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

  describe('findWorkspacePyProjectNames', () => {
    const writePyproject = (relDir: string, content: string): void => {
      const projDir = join(dir, relDir);
      mkdirSync(projDir, { recursive: true });
      writeFileSync(join(projDir, 'pyproject.toml'), content);
    };

    it('reads [project].name from pyproject.toml files', async () => {
      writePyproject(
        'packages/a',
        '[project]\nname = "pkg_a"\nversion = "1.0"\n',
      );
      writePyproject('packages/b', '[project]\nname = "pkg_b"\n');

      const names = await findWorkspacePyProjectNames(dir);
      expect(names.sort()).toEqual(['pkg_a', 'pkg_b']);
    });

    it('reads the project name regardless of quote style or table order', async () => {
      // Single-quoted, and a `name` under another table first — a line-based
      // regex would mis-read the dependency-group name; TOML parsing is correct.
      writePyproject(
        'packages/c',
        [
          '[tool.uv]',
          'name = "not-the-project"',
          '',
          '[project]',
          "name = 'pkg_c'",
        ].join('\n'),
      );

      const names = await findWorkspacePyProjectNames(dir);
      expect(names).toEqual(['pkg_c']);
    });

    it('skips malformed toml without throwing', async () => {
      writePyproject('packages/bad', 'this is = = not valid toml [[[');
      writePyproject('packages/good', '[project]\nname = "ok"\n');

      const names = await findWorkspacePyProjectNames(dir);
      expect(names).toEqual(['ok']);
    });

    it('skips names with shell metacharacters', async () => {
      // The name reaches a shell command, so a name carrying a command
      // separator must never be passed through.
      writePyproject(
        'packages/evil',
        '[project]\nname = "evil; touch /tmp/pwned #"\n',
      );
      writePyproject('packages/safe', '[project]\nname = "safe_pkg"\n');

      const names = await findWorkspacePyProjectNames(dir);
      expect(names).toEqual(['safe_pkg']);
    });
  });

  it('does not interpolate an injected project name into the command', async () => {
    writeVenv(dir);
    mockExecSync.mockReturnValue('[]');

    await collectPythonDependencies({
      start: dir,
      excludePackages: ['good_pkg', 'evil; touch /tmp/pwned #'],
    });

    const command = mockExecSync.mock.calls[0][0] as string;
    expect(command).toContain('good_pkg');
    expect(command).not.toContain('touch');
    expect(command).not.toContain(';');
  });
});
