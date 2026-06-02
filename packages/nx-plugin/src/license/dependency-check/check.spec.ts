/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runCheck, formatReport } from './check';
import { AllowlistEntry } from './types';

const allow: AllowlistEntry[] = [
  { spdxId: 'MIT', fullName: 'MIT License', aliases: [] },
  { spdxId: 'Apache-2.0', fullName: 'Apache License 2.0', aliases: [] },
];

const writePkg = (
  parent: string,
  name: string,
  version: string,
  license: string | null,
): void => {
  const dir = name.startsWith('@')
    ? join(parent, name.split('/')[0], name.split('/')[1])
    : join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version, license }),
  );
};

describe('runCheck', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-'));
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'project-under-test',
        version: '0.0.0',
        private: true,
      }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when every dep is in the allowlist', async () => {
    writePkg(join(dir, 'node_modules'), 'mit-pkg', '1.0.0', 'MIT');
    writePkg(join(dir, 'node_modules'), 'apache-pkg', '2.0.0', 'Apache-2.0');
    const result = await runCheck({
      projectRoot: dir,
      config: { allow },
    });
    expect(result.pass).toBe(true);
    expect(result.dependencies.length).toBeGreaterThan(0);
  });

  it('fails when a dep declares a denied license', async () => {
    writePkg(join(dir, 'node_modules'), 'gpl-pkg', '1.0.0', 'GPL-3.0');
    const result = await runCheck({
      projectRoot: dir,
      config: { allow },
    });
    expect(result.pass).toBe(false);
    expect(
      result.dependencies.some(
        (d) => d.name === 'gpl-pkg' && d.status === 'NOT_APPROVED',
      ),
    ).toBe(true);
  });

  it('honours per-package exceptions', async () => {
    writePkg(join(dir, 'node_modules'), 'gpl-pkg', '1.0.0', 'GPL-3.0');
    const result = await runCheck({
      projectRoot: dir,
      config: {
        allow,
        exceptions: [
          {
            package: 'gpl-pkg',
            reason: 'Test override',
          },
        ],
      },
    });
    expect(result.pass).toBe(true);
  });

  it('fails when a dep declares no license', async () => {
    writePkg(join(dir, 'node_modules'), 'no-license-pkg', '1.0.0', null);
    const result = await runCheck({
      projectRoot: dir,
      config: { allow },
    });
    expect(result.pass).toBe(false);
    expect(
      result.dependencies.some(
        (d) => d.name === 'no-license-pkg' && d.status === 'UNKNOWN',
      ),
    ).toBe(true);
  });

  it('formatReport summarises pass and fail', async () => {
    const passing = await runCheck({
      projectRoot: dir,
      config: { allow },
    });
    expect(formatReport(passing)).toContain('License check passed');

    writePkg(join(dir, 'node_modules'), 'gpl-pkg', '1.0.0', 'GPL-3.0');
    const failing = await runCheck({
      projectRoot: dir,
      config: { allow },
    });
    const report = formatReport(failing);
    expect(report).toContain('License check failed');
    expect(report).toContain('gpl-pkg@1.0.0');
    expect(report).toContain('pnpm why');
    expect(report).toContain("{ package: 'gpl-pkg'");
    expect(report).toContain("spdxId: 'GPL-3.0'");
  });

  it('returns empty when there is no node_modules', async () => {
    rmSync(join(dir, 'node_modules'), { recursive: true });
    const result = await runCheck({
      projectRoot: dir,
      config: { allow },
    });
    expect(result.pass).toBe(true);
    expect(result.dependencies).toEqual([]);
  });
});
