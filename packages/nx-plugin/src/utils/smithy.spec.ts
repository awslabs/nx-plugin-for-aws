/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { logger } from '@nx/devkit';
import { smithyCliCommand, warnIfSmithyMissing } from './smithy';
import { MISE_VERSIONS, TS_VERSIONS } from './versions';

/** Repo root, from `packages/nx-plugin/src/utils`. */
const REPO_ROOT = join(__dirname, '../../../..');

/**
 * The Windows behaviour, which CI cannot exercise from a Linux runner: `mise`
 * publishes no Windows package to npm, so there the CLI is a user-installed
 * prerequisite invoked directly. Both branches are covered here by standing in for
 * the platform, since getting this wrong silently strands Windows users on a
 * command that cannot resolve.
 */
const onPlatform = (platform: string, run: () => void) => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
  try {
    run();
  } finally {
    Object.defineProperty(process, 'platform', {
      value: original,
      configurable: true,
    });
  }
};

describe('smithyCliCommand', () => {
  it('should resolve the pinned cli through mise off windows', () => {
    onPlatform('linux', () => {
      expect(smithyCliCommand()).toBe(
        `npx -y mise@${TS_VERSIONS.mise} exec smithy@${MISE_VERSIONS.smithy} -- smithy`,
      );
    });
  });

  /**
   * Both versions must stay greppable by the version sync, which moves them
   * forward by matching them in the generated command.
   */
  it('should pin both versions off windows so the version sync can move them', () => {
    onPlatform('linux', () => {
      const command = smithyCliCommand();

      expect(command).toContain(`mise@${TS_VERSIONS.mise}`);
      expect(command).toContain(`smithy@${MISE_VERSIONS.smithy}`);
    });
  });

  /**
   * CI prepares the Smithy CLI before running any build, reading both pins out
   * of `versions.ts` with `.github/scripts/tool-pins.mjs` (it runs before
   * `pnpm i`, so it cannot import the module). That parse is by regex, so a
   * reshape of either declaration would leave CI silently preparing nothing —
   * caught here rather than by a flaky Smithy compile.
   */
  it('should expose both pins to the ci tool-pin script', () => {
    const output = execFileSync(
      process.execPath,
      [join(REPO_ROOT, '.github/scripts/tool-pins.mjs')],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    );

    expect(output).toContain(`smithy-version=${MISE_VERSIONS.smithy}\n`);
    expect(output).toContain(`mise-version=${TS_VERSIONS.mise}\n`);
  });

  it('should invoke the cli directly on windows', () => {
    onPlatform('win32', () => {
      // No version to pin: the CLI comes from the user's PATH.
      expect(smithyCliCommand()).toBe('smithy');
    });
  });
});

describe('warnIfSmithyMissing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not warn off windows, where mise resolves the cli', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const probe = vi.fn(() => false);

    onPlatform('linux', () => warnIfSmithyMissing(probe));

    expect(warn).not.toHaveBeenCalled();
    // Nothing to look for, so the PATH is never probed.
    expect(probe).not.toHaveBeenCalled();
  });

  it('should warn on windows when the cli is not on the path', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    onPlatform('win32', () => warnIfSmithyMissing(() => false));

    expect(warn).toHaveBeenCalledTimes(1);
    // Points at the install guide, so the message is actionable.
    expect(vi.mocked(warn).mock.calls[0][0]).toContain(
      'smithy.io/2.0/guides/smithy-cli/cli_installation.html',
    );
  });

  it('should stay quiet on windows when the cli is installed', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    onPlatform('win32', () => warnIfSmithyMissing(() => true));

    expect(warn).not.toHaveBeenCalled();
  });
});
