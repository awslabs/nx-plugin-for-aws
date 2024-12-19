/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'child_process';
import { join } from 'path';
import { output, PackageManager } from '@nx/devkit';
import { existsSync } from 'fs';
import { backOff } from 'exponential-backoff';

export interface RunCmdOpts {
  silenceError?: boolean;
  prefixWithPackageManagerCmd?: boolean;
  retry?: boolean;
  env?: Record<string, string | undefined>;
  cwd?: string;
  silent?: boolean;
  verbose?: boolean;
  redirectStderr?: boolean;
}

export async function runCLI(
  command: string,
  opts: RunCmdOpts = {
    prefixWithPackageManagerCmd: true,
    silenceError: false,
    env: undefined,
    verbose: undefined,
    redirectStderr: undefined,
  }
): Promise<string> {
  try {
    const pm = getPackageManagerCommand();
    const commandToRun = `${
      opts.prefixWithPackageManagerCmd !== false ? `${pm.runNxSilent} ` : ''
    }${command} ${opts.verbose ? ' --verbose' : ''}${
      opts.redirectStderr ? ' 2>&1' : ''
    }`;

    const execCmd = () =>
      new Promise<string>((resolve, reject) => {
        try {
          const result = execSync(commandToRun, {
            cwd: opts.cwd || tmpProjPath(),
            env: {
              PATH: process.env.PATH,
              ...opts.env,
              ...process.env,
            },
            encoding: 'utf-8',
            stdio: 'inherit',
            maxBuffer: 50 * 1024 * 1024,
          });
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    const logs = await (opts.retry ? backOff(execCmd) : execCmd());

    if (opts.verbose) {
      output.log({
        title: `Original command: ${command}`,
        bodyLines: [logs as string],
        color: 'green',
      });
    }

    const r = stripConsoleColors(logs);

    return r;
  } catch (e) {
    if (opts.silenceError) {
      return stripConsoleColors(e.stdout + e.stderr);
    } else {
      logError(`Original command: ${command}`, `${e}`);
      throw e;
    }
  }
}

function detectPackageManager(dir = ''): PackageManager {
  return existsSync(join(dir, 'bun.lockb'))
    ? 'bun'
    : existsSync(join(dir, 'yarn.lock'))
    ? 'yarn'
    : existsSync(join(dir, 'pnpm-lock.yaml')) ||
      existsSync(join(dir, 'pnpm-workspace.yaml'))
    ? 'pnpm'
    : 'npm';
}

function getYarnMajorVersion(path: string): string | undefined {
  try {
    // this fails if path is not yet created
    const [yarnMajorVersion] = execSync(`yarn -v`, {
      cwd: path,
      encoding: 'utf-8',
    }).split('.');
    return yarnMajorVersion;
  } catch {
    try {
      const [yarnMajorVersion] = execSync(`yarn -v`, {
        encoding: 'utf-8',
      }).split('.');
      return yarnMajorVersion;
    } catch {
      return undefined;
    }
  }
}

export function tmpProjPath() {
  return `/tmp/nx-plugin/e2e`;
}

function getPackageManagerCommand({
  path = tmpProjPath(),
  packageManager = detectPackageManager(path),
} = {}): {
  runNxSilent: string;
} {
  const yarnMajorVersion = getYarnMajorVersion(path);

  return {
    npm: {
      runNxSilent: `npx nx`,
    },
    yarn: {
      runNxSilent:
        yarnMajorVersion && +yarnMajorVersion >= 2
          ? 'yarn nx'
          : `yarn --silent nx`,
    },
    // Pnpm 3.5+ adds nx to
    pnpm: {
      runNxSilent: `pnpm exec nx`,
    },
    bun: {
      runNxSilent: `bunx nx`,
    },
  }[packageManager.trim() as PackageManager];
}

/**
 * Remove log colors for fail proof string search
 * @param log
 * @returns
 */
function stripConsoleColors(log: string): string {
  return log?.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

function logError(message: string, body?: string) {
  process.stdout.write('\n');
  process.stdout.write(`${message}\n`);
  if (body) {
    process.stdout.write(`${body}\n`);
  }
  process.stdout.write('\n');
}
