/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ExecutorContext, workspaceRoot } from '@nx/devkit';
import { runCheck, formatReport } from './check';
import { DependencyCheckConfig } from './types';
import { readAwsNxPluginConfigFromDisk } from '../../utils/config/utils';
import { npmCollector, LicenseCollector } from './collectors/collector';

export type LicenseCheckExecutorSchema = Record<string, never>;

const loadConfig = (): DependencyCheckConfig | null => {
  const config = readAwsNxPluginConfigFromDisk(workspaceRoot);
  if (!config) return null;

  // Dependency checking is enabled by the presence of `license.dependencies`.
  return config.license?.dependencies ?? null;
};

export default async function runLicenseCheckExecutor(
  _options: LicenseCheckExecutorSchema,
  _context: ExecutorContext,
): Promise<{ success: boolean }> {
  if (process.env.LICENSE_DEPENDENCY_CHECK === 'skip') {
    console.log(
      'License check skipped via LICENSE_DEPENDENCY_CHECK=skip environment variable.',
    );
    return { success: true };
  }

  const config = loadConfig();
  if (!config) {
    console.log('License check skipped — not configured.');
    return { success: true };
  }

  const collectors: LicenseCollector[] = config.collectors ?? [npmCollector()];

  const result = await runCheck({
    projectRoot: workspaceRoot,
    config,
    collectors,
  });

  const report = formatReport(result, { collectors });

  if (result.pass) {
    console.log(report);
    return { success: true };
  }

  console.error(report);
  return { success: false };
}
