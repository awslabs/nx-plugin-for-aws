/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createEvaluator } from './evaluator';
import { DEFAULT_COLLECTORS, LicenseCollector } from './collector';
import {
  CheckedDependency,
  CheckResult,
  DependencyCheckConfig,
  DependencyCheckException,
} from './types';

export interface RunCheckOptions {
  /** Workspace root, used to discover dependencies. */
  projectRoot: string;
  /** Resolved dependency check config. */
  config: DependencyCheckConfig;
  /** Custom collectors — defaults to npm + python if not specified. */
  collectors?: LicenseCollector[];
}

const findException = (
  exceptions: DependencyCheckException[] | undefined,
  name: string,
  version: string,
): DependencyCheckException | undefined => {
  if (!exceptions) return undefined;
  return exceptions.find(
    (e) => e.package === name && (!e.version || e.version === version),
  );
};

export const runCheck = async (
  options: RunCheckOptions,
): Promise<CheckResult> => {
  const { projectRoot, config } = options;
  const collectors = options.collectors ?? DEFAULT_COLLECTORS;
  const evaluator = createEvaluator({ allow: config.allow });

  const allDeps = await Promise.all(
    collectors.map((c) => c.collect({ workspaceRoot: projectRoot })),
  );

  const dependencies: CheckedDependency[] = [];

  for (const deps of allDeps) {
    for (const dep of deps) {
      const exception = findException(config.exceptions, dep.name, dep.version);
      const license = exception?.spdx ?? dep.rawLicense;
      const status = exception ? 'PRE_APPROVED' : evaluator.evaluate(license);
      dependencies.push({
        name: dep.name,
        version: dep.version,
        ecosystem: dep.ecosystem,
        rawLicense: dep.rawLicense,
        status,
        exception,
      });
    }
  }

  const pass = !dependencies.some(
    (d) => d.status === 'NOT_APPROVED' || d.status === 'UNKNOWN',
  );

  return { pass, dependencies };
};

export interface FormatReportOptions {
  collectors?: LicenseCollector[];
}

export const formatReport = (
  result: CheckResult,
  options?: FormatReportOptions,
): string => {
  const groups = new Map<string, CheckedDependency[]>();
  for (const dep of result.dependencies) {
    if (dep.status === 'PRE_APPROVED') continue;
    const arr = groups.get(dep.status) ?? [];
    arr.push(dep);
    groups.set(dep.status, arr);
  }

  if (groups.size === 0) {
    const total = result.dependencies.length;
    return `License check passed (${total} dependencies inspected).`;
  }

  const failing = [
    ...(groups.get('NOT_APPROVED') ?? []),
    ...(groups.get('UNKNOWN') ?? []),
  ];

  const lines: string[] = ['License check failed:', ''];
  for (const status of ['NOT_APPROVED', 'UNKNOWN'] as const) {
    const deps = groups.get(status);
    if (!deps || deps.length === 0) continue;
    lines.push(`  ${status}:`);
    for (const dep of deps) {
      const license = dep.rawLicense || '(no license declared)';
      lines.push(
        `    - ${dep.name}@${dep.version} [${dep.ecosystem}] ${license}`,
      );
    }
    lines.push('');
  }

  const collectors = options?.collectors ?? DEFAULT_COLLECTORS;
  const activeEcosystems = new Set(result.dependencies.map((d) => d.ecosystem));
  const ecosystemToCollector = new Map<string, LicenseCollector>();
  for (const c of collectors) {
    const eco = c.name === 'python' ? 'pypi' : c.name;
    ecosystemToCollector.set(eco, c);
  }
  const traceCommands = collectors.filter((c) => {
    const eco = c.name === 'python' ? 'pypi' : c.name;
    return activeEcosystems.has(eco);
  });
  if (traceCommands.length > 0) {
    lines.push('To trace the dependency chain:');
    for (const c of traceCommands) {
      lines.push(`  ${c.name}: ${c.traceCommand}`);
    }
    lines.push('');
  }

  lines.push(
    'To fix, add exceptions to license.dependencyCheck.exceptions in aws-nx-plugin.config.mts:',
  );
  lines.push('');
  lines.push('  exceptions: [');
  for (const dep of failing) {
    lines.push(`    { package: '${dep.name}', reason: '<your reason>' },`);
  }
  lines.push('  ]');
  lines.push('');
  const uniqueLicenses = [
    ...new Set(
      failing
        .filter((d) => d.rawLicense && d.status === 'NOT_APPROVED')
        .map((d) => d.rawLicense),
    ),
  ];
  if (uniqueLicenses.length > 0) {
    lines.push(
      'Or add the license to dependencyCheck.allow if it should be broadly permitted:',
    );
    lines.push('');
    lines.push('  allow: [');
    for (const lic of uniqueLicenses) {
      lines.push(`    { spdxId: '${lic}', fullName: '${lic}', aliases: [] },`);
    }
    lines.push('  ]');
  }

  return lines.join('\n');
};
