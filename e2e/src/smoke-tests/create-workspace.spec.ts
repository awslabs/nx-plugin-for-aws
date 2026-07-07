/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { PackageManager } from '@nx/devkit';
import { ensureDirSync } from 'fs-extra';
import * as pty from 'node-pty';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCreateNxWorkspaceCommand,
  createTestWorkspace,
  runCLI,
  tmpProjPath,
} from '../utils';
import { activatePackageManagerViaCorepack } from './corepack';

/**
 * Verifies `<pkgMgr> create @aws/nx-workspace` runs unattended with
 * `--no-interactive` — no `iac`, no `--skipGit`, no extra flags.
 *
 * Yarn is exercised twice — classic and berry (yarn 4 via corepack) —
 * since they drive different code paths.
 *
 * A separate interactive case drives the preset generator directly via
 * `nx generate` through a PTY, exercising the `enquirer.prompt` engagementId
 * prompt that non-interactive runs skip.
 */
interface Variant {
  variant: string;
  pkgMgr: PackageManager;
  setup?: () => undefined | (() => void);
}

const VARIANTS: Variant[] = [
  { variant: 'npm', pkgMgr: 'npm' },
  { variant: 'pnpm', pkgMgr: 'pnpm' },
  {
    variant: 'yarn-classic',
    pkgMgr: 'yarn',
    setup: () => activatePackageManagerViaCorepack('yarn', 1),
  },
  {
    variant: 'yarn-4',
    pkgMgr: 'yarn',
    setup: () =>
      activatePackageManagerViaCorepack('yarn', 4, {
        YARN_ENABLE_HARDENED_MODE: '0',
        YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
      }),
  },
  { variant: 'bun', pkgMgr: 'bun' },
];

/**
 * Run a command through a PTY (so the child sees a real TTY on stdin), type
 * `answer` once `promptMatch` appears in the output, and resolve when the child
 * exits successfully. Rejects on non-zero exit or timeout.
 */
function runInteractive(opts: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  promptMatch: string;
  answer: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const term = pty.spawn('sh', ['-c', opts.command], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });
    let out = '';
    let answered = false;
    let settled = false;
    const clean = () => stripVTControlCharacters(out);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        term.kill();
      } catch {
        // already dead
      }
      err ? reject(err) : resolve(clean());
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `Command did not complete within ${opts.timeoutMs}ms. Output:\n${clean()}`,
          ),
        ),
      opts.timeoutMs,
    );
    term.onData((d) => {
      out += d;
      process.stdout.write(d);
      if (!answered && clean().includes(opts.promptMatch)) {
        answered = true;
        setTimeout(() => term.write(`${opts.answer}\r`), 500);
      }
    });
    term.onExit(({ exitCode }) => {
      if (exitCode === 0 && answered) {
        finish();
      } else if (exitCode === 0) {
        finish(
          new Error(
            `Command exited before prompt "${opts.promptMatch}" appeared. Output:\n${clean()}`,
          ),
        );
      } else {
        finish(
          new Error(
            `Command exited with code ${exitCode}. Output:\n${clean()}`,
          ),
        );
      }
    });
  });
}

describe('smoke test - create-workspace', () => {
  VARIANTS.forEach(({ variant, pkgMgr, setup }) => {
    describe(variant, () => {
      const targetDir = `${tmpProjPath()}/create-workspace-${variant}`;
      const projectRoot = `${targetDir}/e2e-test`;
      let teardown: (() => void) | undefined;

      beforeEach(() => {
        teardown = setup?.();
        if (existsSync(targetDir)) {
          rmSync(targetDir, { force: true, recursive: true });
        }
        ensureDirSync(targetDir);
      });
      afterEach(() => {
        teardown?.();
        teardown = undefined;
      });

      it(`Should create a workspace with --no-interactive - ${variant}`, async () => {
        await runCLI(
          `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test')} --no-interactive`,
          {
            cwd: targetDir,
            prefixWithPackageManagerCmd: false,
            redirectStderr: true,
          },
        );

        expect(existsSync(`${projectRoot}/package.json`)).toBe(true);
        expect(existsSync(`${projectRoot}/nx.json`)).toBe(true);
        expect(existsSync(`${projectRoot}/aws-nx-plugin.config.mts`)).toBe(
          true,
        );
      });
    });
  });

  // Drives the preset generator's interactive engagementId prompt, which
  // `--no-interactive` skips. `create-nx-workspace` runs the preset via `exec`
  // (a data-less pipe on stdin, so the prompt is skipped there); the prompt
  // only runs with a real TTY, so re-run the preset directly via `nx generate`
  // through a PTY. This exercises the `enquirer.prompt` call, guarding against
  // ESM/CJS interop regressions in the enquirer import. The prompt only appears
  // for Amazon employees (git email on an amazon.* domain), so pin git config
  // to an amazon.com email. Package manager agnostic, so exercised once (pnpm).
  describe('interactive', () => {
    const pkgMgr = 'pnpm';
    const targetDir = `${tmpProjPath()}/create-workspace-interactive`;
    let projectRoot: string;
    let gitConfigDir: string;

    beforeEach(
      async () => {
        if (existsSync(targetDir)) {
          rmSync(targetDir, { force: true, recursive: true });
        }
        ensureDirSync(targetDir);

        // Isolate git config so the preset detects an "Amazonian" email without
        // touching the user's real git config.
        gitConfigDir = mkdtempSync(join(tmpdir(), 'nx-e2e-gitconfig-'));
        writeFileSync(
          join(gitConfigDir, 'global'),
          '[user]\n\temail = e2e-test@amazon.com\n\tname = E2E Test\n',
        );
        // Empty file so no system git config (e.g. an @example.com email) leaks
        // in and masks the amazon.com email above.
        writeFileSync(join(gitConfigDir, 'system'), '');

        // Non-interactive workspace to re-run the preset generator inside.
        projectRoot = await createTestWorkspace(pkgMgr, targetDir, 'e2e-test');
      },
      10 * 60 * 1000,
    );
    afterEach(() => {
      if (gitConfigDir && existsSync(gitConfigDir)) {
        rmSync(gitConfigDir, { force: true, recursive: true });
      }
    });

    it('Should prompt for an engagementId and store it as a tag', async () => {
      await runInteractive({
        // Pass every schema option with an `x-prompt` (iac, containers) so Nx
        // doesn't prompt for them under a TTY — leaving only the generator's
        // own engagementId prompt to answer.
        command:
          'pnpm exec nx generate @aws/nx-plugin:preset --iac=cdk --containers=docker --preferInstallDependencies=false',
        cwd: projectRoot,
        promptMatch: 'engagementId',
        answer: 'MyEngagementId',
        timeoutMs: 5 * 60 * 1000,
        env: {
          // The preset skips the prompt under CI/tests; clear both so the
          // interactive branch runs. `create-nx-workspace`'s AI-agent detection
          // (CLAUDECODE/CLAUDE_CODE) also forces non-interactive, so clear those.
          CI: '',
          VITEST: '',
          CLAUDECODE: '',
          CLAUDE_CODE: '',
          // Point git at the isolated amazon.com email config.
          GIT_CONFIG_GLOBAL: join(gitConfigDir, 'global'),
          GIT_CONFIG_SYSTEM: join(gitConfigDir, 'system'),
        },
      });

      // The answered engagementId is stored as a tag in the plugin config.
      const configPath = `${projectRoot}/aws-nx-plugin.config.mts`;
      expect(existsSync(configPath)).toBe(true);
      expect(readFileSync(configPath, 'utf-8')).toContain('MyEngagementId');
    });
  });
});
