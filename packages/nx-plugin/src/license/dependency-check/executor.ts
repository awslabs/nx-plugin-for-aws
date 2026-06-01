/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ExecutorContext, workspaceRoot } from '@nx/devkit';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { runCheck, formatReport } from './check';
import { DependencyCheckConfig } from './types';
import { AwsNxPluginConfig } from '../../utils/config';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../../utils/config/utils';
import { PRE_APPROVED_LICENSES } from './pre-approved';
import {
  DEFAULT_COLLECTORS,
  LicenseCollector,
  npmCollector,
} from './collector';

export type LicenseCheckExecutorSchema = Record<string, never>;

const loadConfig = async (): Promise<DependencyCheckConfig | null> => {
  const configPath = resolve(workspaceRoot, AWS_NX_PLUGIN_CONFIG_FILE_NAME);
  if (!existsSync(configPath)) return null;

  let config: AwsNxPluginConfig;
  try {
    const { tsImport } = await import('tsx/esm/api');
    const mod = await tsImport(configPath, pathToFileURL(__filename).href);
    config = (mod.default ?? mod) as AwsNxPluginConfig;
  } catch {
    // Fallback: read and evaluate with inlined constant
    const { readFileSync } = await import('fs');
    const { importTypeScriptModule } = await import('../../utils/js');
    let source = readFileSync(configPath, 'utf-8');
    if (source.includes('@aws/nx-plugin/license')) {
      source = source.replace(
        /import\s*\{[^}]*\}\s*from\s*['"]@aws\/nx-plugin\/license['"];?\n?/,
        `const DEFAULT_LICENSE_ALLOWLIST = ${JSON.stringify(PRE_APPROVED_LICENSES)};\n`,
      );
    }
    config = await importTypeScriptModule(source);
  }

  const license = config?.license;
  if (!license) return null;
  const dc = license.dependencyCheck;
  if (dc === false || dc === undefined) return null;
  return dc as DependencyCheckConfig;
};

export default async function runLicenseCheckExecutor(
  options: LicenseCheckExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  if (process.env.LICENSE_DEPENDENCY_CHECK === 'skip') {
    console.log(
      'License check skipped via LICENSE_DEPENDENCY_CHECK=skip environment variable.',
    );
    return { success: true };
  }

  const config = await loadConfig();
  if (!config) {
    console.log('License check skipped — not configured.');
    return { success: true };
  }

  const collectors = config.collectors ?? [npmCollector()];

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
