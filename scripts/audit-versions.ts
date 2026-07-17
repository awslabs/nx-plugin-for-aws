/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PY_VERSIONS,
  TS_VERSIONS,
} from '../packages/nx-plugin/src/utils/versions';

/**
 * Severity gate for the TypeScript audit. The vended dependency set is
 * currently free of critical advisories but carries a single transitive high
 * (serialize-javascript, via @nx-extend/terraform -> hcl2-json-parser -> mocha),
 * so the gate is pinned to `critical`. Ratchet down to `high` once that advisory
 * clears upstream.
 */
const TS_AUDIT_LEVEL = process.env.TS_AUDIT_LEVEL ?? 'critical';

/**
 * Python interpreter used to resolve the vended dependency set. Pinned below the
 * base image's 3.14 because a vended dependency (ag-ui-strands) still requires
 * python <3.14; auditing under 3.13 lets the set resolve.
 */
const PY_AUDIT_PYTHON = process.env.PY_AUDIT_PYTHON ?? '3.13';

type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';
const SEVERITY_ORDER: Severity[] = [
  'info',
  'low',
  'moderate',
  'high',
  'critical',
];

interface TsAuditResult {
  counts: Record<Severity, number>;
  advisories: {
    severity: string;
    module: string;
    title: string;
    url: string;
  }[];
  gateBreached: boolean;
}

interface PyVulnerability {
  requirement: string;
  detail: string;
}

/**
 * Vends a package.json containing every dependency in TS_VERSIONS, resolves a
 * lockfile against the configured registry, and audits production dependencies.
 */
const auditTypeScript = (tmpDir: string): TsAuditResult => {
  const tsDir = join(tmpDir, 'ts');
  mkdirSync(tsDir, { recursive: true });

  const packageJson = {
    name: 'vended-ts-audit',
    version: '0.0.0',
    private: true,
    dependencies: { ...TS_VERSIONS },
  };
  writeFileSync(
    join(tsDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  );

  // Audit against the public registry so results reflect what users install,
  // independent of any ambient registry mirror configuration.
  writeFileSync(
    join(tsDir, '.npmrc'),
    'registry=https://registry.npmjs.org/\n',
  );

  console.log('Resolving lockfile for vended TypeScript dependencies...');
  execSync('pnpm install --lockfile-only --ignore-scripts', {
    cwd: tsDir,
    stdio: 'inherit',
  });

  console.log('Auditing vended TypeScript dependencies...');
  // `pnpm audit` exits non-zero when advisories are found, so capture output
  // rather than letting execSync throw.
  let auditJson = '';
  try {
    auditJson = execSync('pnpm audit --prod --json', {
      cwd: tsDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    auditJson = (error as { stdout?: string }).stdout ?? '';
  }

  const parsed = JSON.parse(auditJson) as {
    advisories?: Record<
      string,
      { severity: string; module_name: string; title: string; url: string }
    >;
    metadata?: { vulnerabilities?: Record<Severity, number> };
  };

  const counts: Record<Severity, number> = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    ...(parsed.metadata?.vulnerabilities ?? {}),
  };

  const advisories = Object.values(parsed.advisories ?? {}).map((a) => ({
    severity: a.severity,
    module: a.module_name,
    title: a.title,
    url: a.url,
  }));

  // The gate is breached when any advisory at or above TS_AUDIT_LEVEL is present.
  const threshold = SEVERITY_ORDER.indexOf(TS_AUDIT_LEVEL as Severity);
  const gateBreached = SEVERITY_ORDER.some(
    (sev, i) => i >= threshold && counts[sev] > 0,
  );

  return { counts, advisories, gateBreached };
};

/**
 * Audits every dependency in PY_VERSIONS. The vended set spans multiple
 * mutually-incompatible projects (e.g. boto3 vs aws-opentelemetry-distro), so it
 * cannot be resolved as a single environment; each pinned requirement is audited
 * independently (with its own transitive tree) via pip-audit. Reporting only —
 * pip-audit does not expose a severity threshold.
 */
const auditPython = (tmpDir: string): PyVulnerability[] => {
  const vulnerabilities: PyVulnerability[] = [];
  const requirementsPath = join(tmpDir, 'requirement.txt');

  for (const [pkg, version] of Object.entries(PY_VERSIONS)) {
    const requirement = `${pkg}${version}`;
    console.log(`Auditing vended Python dependency: ${requirement}`);
    writeFileSync(requirementsPath, `${requirement}\n`);

    let output = '';
    try {
      output = execSync(
        `uvx --python ${PY_AUDIT_PYTHON} pip-audit -r "${requirementsPath}" --progress-spinner off`,
        {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 180_000,
        },
      );
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    }

    if (/No known vulnerabilities/i.test(output)) {
      continue;
    }

    // Extract the vulnerability table if pip-audit reported findings.
    if (/Found \d+ known vulnerabilit/i.test(output)) {
      const detail = output
        .split('\n')
        .filter(
          (l) =>
            !/^(WARNING|INFO|Installed|Downloading|Downloaded|Resolved|Prepared|Audited|Requirement)/.test(
              l.trim(),
            ) && l.trim().length > 0,
        )
        .join('\n');
      vulnerabilities.push({ requirement, detail });
    }
  }

  return vulnerabilities;
};

/**
 * Writes the audit report to disk and prints it.
 */
const writeReport = (ts: TsAuditResult, py: PyVulnerability[]): void => {
  const reportDir = join(process.cwd(), 'dist', 'scripts', 'audit-versions');
  mkdirSync(reportDir, { recursive: true });

  let report = '## Dependency Audit\n\n';

  report += `### TypeScript (gate: ${TS_AUDIT_LEVEL})\n\n`;
  report += `info: ${ts.counts.info}, low: ${ts.counts.low}, moderate: ${ts.counts.moderate}, high: ${ts.counts.high}, critical: ${ts.counts.critical}\n\n`;
  if (ts.advisories.length > 0) {
    for (const a of ts.advisories) {
      report += `- [${a.severity}] ${a.module}: ${a.title}\n  ${a.url}\n`;
    }
  } else {
    report += 'No advisories.\n';
  }
  report += ts.gateBreached
    ? `\n**Gate breached: advisories at or above \`${TS_AUDIT_LEVEL}\` present.**\n`
    : `\nGate passed: no advisories at or above \`${TS_AUDIT_LEVEL}\`.\n`;

  report += `\n### Python (report-only, python ${PY_AUDIT_PYTHON})\n\n`;
  if (py.length > 0) {
    for (const v of py) {
      report += `<details><summary>${v.requirement}</summary>\n\n\`\`\`\n${v.detail}\n\`\`\`\n</details>\n\n`;
    }
  } else {
    report += 'No known vulnerabilities in vended Python dependencies.\n';
  }

  writeFileSync(join(reportDir, 'report.md'), report);
  writeFileSync(
    join(reportDir, 'gate-status.txt'),
    ts.gateBreached ? 'breached' : 'passed',
  );

  console.log('\n' + report);
};

const main = () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'audit-versions-'));
  console.log(`Created temporary directory: ${tmpDir}`);

  const ts = auditTypeScript(tmpDir);
  const py = auditPython(tmpDir);

  writeReport(ts, py);

  if (ts.gateBreached) {
    console.error(
      `TypeScript audit gate breached at level "${TS_AUDIT_LEVEL}".`,
    );
    process.exit(1);
  }
};

main();
