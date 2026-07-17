/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { beforeAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line
import {
  CONTAINER_VERSIONS,
  PY_VERSIONS,
  TS_VERSIONS,
} from '../../../packages/nx-plugin/src/utils/versions';
import { tmpProjPath } from '../utils';

/**
 * Fails the build if any production dependency the plugin ships — its own and
 * the versions it vends into generated projects — has a known CRITICAL
 * vulnerability with a fix available.
 *
 * A single tool (Trivy, already pinned in CONTAINER_VERSIONS and used by the
 * container-image scan targets) covers every ecosystem and emits parseable
 * JSON, so severity is read from the report rather than scraped from text.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const TRIVY_IMAGE = `public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy}`;

interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
}

interface TrivyReport {
  Results?: { Target: string; Vulnerabilities?: TrivyVulnerability[] }[];
}

/**
 * Runs `trivy fs` over a lockfile directory, filtering to fixable CRITICAL
 * vulnerabilities, and returns the flattened list of findings.
 */
const scanForCriticalVulnerabilities = (
  scanDir: string,
): TrivyVulnerability[] => {
  const stdout = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${scanDir}:/scan`,
      TRIVY_IMAGE,
      'fs',
      '/scan',
      '--scanners',
      'vuln',
      '--severity',
      'CRITICAL',
      '--ignore-unfixed',
      '--format',
      'json',
      '--quiet',
    ],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );

  const report = JSON.parse(stdout) as TrivyReport;
  return (report.Results ?? []).flatMap((r) => r.Vulnerabilities ?? []);
};

const describeFindings = (vulns: TrivyVulnerability[]): string =>
  vulns
    .map(
      (v) =>
        `  - [${v.Severity}] ${v.PkgName} ${v.InstalledVersion} (${v.VulnerabilityID}) fixed in ${v.FixedVersion}`,
    )
    .join('\n');

describe('smoke test - audit', () => {
  const scanRoot = join(tmpProjPath(), 'audit');

  beforeAll(() => {
    if (existsSync(scanRoot)) {
      rmSync(scanRoot, { force: true, recursive: true });
    }
    ensureDirSync(scanRoot);
    // Pre-pull the pinned Trivy image so each scan reuses it.
    execFileSync('docker', ['pull', '--quiet', TRIVY_IMAGE], {
      stdio: 'inherit',
    });
  });

  it("has no critical vulnerabilities in the plugin's own dependencies", () => {
    // Scan the committed root lockfile in isolation — this is the exact
    // dependency tree the plugin is built and published from. Copying it into a
    // dedicated directory keeps the scan off the many nested template manifests
    // under the repo tree.
    const dir = join(scanRoot, 'repo');
    mkdirSync(dir, { recursive: true });
    copyFileSync(
      join(REPO_ROOT, 'pnpm-lock.yaml'),
      join(dir, 'pnpm-lock.yaml'),
    );

    const vulns = scanForCriticalVulnerabilities(dir);
    expect(
      vulns.length,
      `Critical vulnerabilities in the plugin's own dependencies:\n${describeFindings(vulns)}`,
    ).toBe(0);
  });

  it('has no critical vulnerabilities in vended TypeScript dependencies', () => {
    const dir = join(scanRoot, 'ts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'vended-ts-audit',
          version: '0.0.0',
          private: true,
          dependencies: { ...TS_VERSIONS },
        },
        null,
        2,
      ),
    );
    // Resolve against the public registry so the audit reflects what users
    // install, regardless of any registry mirror configured on the runner.
    writeFileSync(
      join(dir, '.npmrc'),
      'registry=https://registry.npmjs.org/\n',
    );

    execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], {
      cwd: dir,
      stdio: 'inherit',
    });

    const vulns = scanForCriticalVulnerabilities(dir);
    expect(
      vulns.length,
      `Critical vulnerabilities in vended TypeScript dependencies:\n${describeFindings(vulns)}`,
    ).toBe(0);
  });

  it('has no critical vulnerabilities in vended Python dependencies', () => {
    const dir = join(scanRoot, 'py');
    mkdirSync(dir, { recursive: true });

    // checkov, ty and pip-* are CLI tools run via uvx, not project runtime
    // dependencies, and are excluded (as in license-check). ag-ui-strands
    // caps python <3.14 and is resolved via its own project.
    const dependencies = Object.entries(PY_VERSIONS)
      .filter(
        ([name]) =>
          name !== 'checkov' &&
          name !== 'ty' &&
          !name.startsWith('pip-') &&
          !name.includes('ag-ui-strands'),
      )
      .map(([name, version]) => `"${name}${version}"`);

    writeFileSync(
      join(dir, 'pyproject.toml'),
      [
        '[project]',
        'name = "vended-py-audit"',
        'version = "0.0.0"',
        'requires-python = ">=3.13,<3.14"',
        `dependencies = [${dependencies.join(', ')}]`,
        '',
      ].join('\n'),
    );

    execFileSync('uvx', ['--python', '3.13', '--from', 'uv', 'uv', 'lock'], {
      cwd: dir,
      stdio: 'inherit',
    });

    const vulns = scanForCriticalVulnerabilities(dir);
    expect(
      vulns.length,
      `Critical vulnerabilities in vended Python dependencies:\n${describeFindings(vulns)}`,
    ).toBe(0);
  });
});
