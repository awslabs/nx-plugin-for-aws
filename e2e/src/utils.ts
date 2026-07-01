/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { output, type PackageManager } from '@nx/devkit';
import { backOff } from 'exponential-backoff';
// eslint-disable-next-line
import {
  buildCreateNxWorkspaceCommand,
  buildPackageManagerShortCommand,
} from '../../packages/nx-plugin/src/utils/commands';
// eslint-disable-next-line
import { TS_VERSIONS } from '../../packages/nx-plugin/src/utils/versions';

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
  },
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
        // `spawn` (not the blocking `execSync`) so multiple `runCLI` calls can
        // run concurrently — isolated smoke-test cases overlap instead of
        // serialising on a blocked event loop. Output is streamed through to
        // the parent as it arrives (preserving live logs) and captured for the
        // return value and error handling.
        const child = spawn(commandToRun, {
          cwd: opts.cwd || tmpProjPath(),
          env: {
            PATH: process.env.PATH,
            ...process.env,
            ...opts.env,
          },
          shell: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
          stdout += chunk;
          process.stdout.write(chunk);
        });
        child.stderr?.on('data', (chunk) => {
          stderr += chunk;
          process.stderr.write(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            const err = new Error(
              `Command failed: ${commandToRun}\n${stderr}`,
            ) as Error & { stdout: string; stderr: string; status: number };
            err.stdout = stdout;
            err.stderr = stderr;
            err.status = code ?? 1;
            reject(err);
          }
        });
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
  // Use a shorter path on Windows to avoid path length issues with deeply
  // nested node_modules and Vite build output
  if (process.platform === 'win32') {
    return 'C:\\nxe2e';
  }
  return join(tmpdir(), 'nx-plugin-for-aws', 'e2e');
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
      runNxSilent: `bun nx`,
    },
  }[packageManager.trim() as PackageManager];
}

/**
 * Run a bare dependency install for the package manager detected in `cwd`.
 *
 * Used by the smoke tests, which generate every project with
 * `--prefer-install-dependencies=false` and then install once at the end.
 *
 * The generators add dependencies to `package.json` without updating the
 * lockfile, so the install must be allowed to update it. CI sets each package
 * manager to a frozen/immutable lockfile by default, hence the explicit flags.
 */
export async function runInstall(opts: {
  cwd: string;
  env?: RunCmdOpts['env'];
}) {
  const pkgMgr = detectPackageManager(opts.cwd);
  const yarnMajor = Number(getYarnMajorVersion(opts.cwd) ?? '1');
  const command = {
    npm: 'npm install --legacy-peer-deps',
    pnpm: 'pnpm install --no-frozen-lockfile',
    // Yarn Berry (>=2) treats the lockfile as immutable in CI; classic does not
    // and rejects the `--no-immutable` flag.
    yarn: yarnMajor >= 2 ? 'yarn install --no-immutable' : 'yarn install',
    bun: 'bun install --no-frozen-lockfile',
  }[pkgMgr];
  await runCLI(command, {
    cwd: opts.cwd,
    env: opts.env,
    prefixWithPackageManagerCmd: false,
    redirectStderr: true,
  });
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
    '',
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

export { buildCreateNxWorkspaceCommand, buildPackageManagerShortCommand };

/**
 * Creates an Nx workspace for an e2e test in `${targetDir}/${name}` and returns
 * its project root.
 *
 * Workspaces are created with git initialised (no `--skipGit`) to match how
 * real users start a project. This matters for tooling that only honours
 * `.gitignore` inside a git work tree — notably `ty`, which would otherwise
 * scan the cache directories ignored by the generated `.gitignore` (such as
 * pytest's transient `pytest-cache-files-*` directories, created and removed
 * while the `test` and `typecheck` targets run concurrently) and intermittently
 * fail with an I/O error.
 */
export const createTestWorkspace = async (
  pkgMgr: string,
  targetDir: string,
  name: string,
  iac?: 'cdk' | 'terraform',
): Promise<string> => {
  await runCLI(
    `${buildCreateNxWorkspaceCommand(pkgMgr, name, iac)} --interactive=false`,
    {
      cwd: targetDir,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
    },
  );
  return join(targetDir, name);
};

// The ts#dynamodb generator already adds electrodb and @aws-sdk/client-dynamodb.
// The Game API's actions.query procedure additionally needs the S3 client to
// read the agent's conversation history.
export const getDungeonAdventureElectroDbDependencies = () =>
  `@aws-sdk/client-s3@${TS_VERSIONS['@aws-sdk/client-s3']}`;
