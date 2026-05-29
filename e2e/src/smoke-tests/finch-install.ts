/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync, spawn, spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const FINCH_VERSION = '1.17.0';

const sh = (cmd: string): void => {
  console.log(`[finch-install] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

const isOnPath = (binary: string): boolean => {
  try {
    execSync(`command -v ${binary}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const hasRunningSystemd = (): boolean => {
  // Canonical sd_booted(3) check: systemd PID 1 always exposes
  // /run/systemd/system. CodeBuild container runners ship the systemctl
  // binary (so wrapping execs around it succeeds in surprising ways) but
  // do not have an init bus, hence checking the marker directly.
  return existsSync('/run/systemd/system');
};

const waitForSocket = (
  path: string,
  timeoutMs = 60_000,
  logPaths: string[] = [],
): void => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return;
    execSync('sleep 1');
  }
  // Surface daemon logs to make timeouts diagnosable on CI.
  for (const logPath of logPaths) {
    if (existsSync(logPath)) {
      console.error(`[finch-install] ----- ${logPath} -----`);
      try {
        console.error(readFileSync(logPath, 'utf-8'));
      } catch (e) {
        console.error(`(failed to read: ${(e as Error).message})`);
      }
    }
  }
  throw new Error(`Timed out waiting for socket ${path}`);
};

const startDaemonsViaSystemd = (): void => {
  sh('sudo systemctl daemon-reload');
  sh('sudo systemctl enable --now containerd');
  sh(
    'sudo systemctl enable --now finch-buildkit.socket finch-buildkit.service',
  );
  sh('sudo systemctl enable --now finch-soci.socket finch-soci.service');
  sh('sudo systemctl enable --now finch.socket finch.service');
  waitForSocket('/run/finch.sock');
};

const startDaemonsManually = (): void => {
  // Mirror the systemd unit invocations shipped by the deb (see
  // /etc/systemd/system/finch*.service) so callers get the same daemon
  // topology on hosts without an active init system — e.g. CodeBuild
  // container-based runners.
  const logDir = join(tmpdir(), 'nx-plugin-for-aws', 'finch-logs');
  sh(`mkdir -p "${logDir}"`);
  sh('sudo mkdir -p /var/lib/finch /var/lib/containerd /run/finch');
  // CodeBuild GHA runners are containers whose rootfs is overlayfs on a
  // 4.14 Amazon Linux 2 kernel. BuildKit's cache mounts then try to
  // overlay-mount on top of that, which the kernel rejects with EINVAL.
  // Mount tmpfs on the dirs containerd/buildkit write to so their
  // overlay mounts have a non-overlay filesystem to anchor on.
  sh('sudo mount -t tmpfs -o size=8g tmpfs /var/lib/containerd || true');
  sh('sudo mount -t tmpfs -o size=8g tmpfs /var/lib/finch || true');
  sh('sudo mkdir -p /var/lib/finch/buildkit');

  // sudo strips PATH via secure_path, so set the daemons' env explicitly
  // via `sudo env VAR=...` rather than relying on spawn's `env` option
  // (which only affects sudo itself, not its child).
  const launch = (name: string, cmd: string[]): void => {
    const out = openSync(join(logDir, `${name}.log`), 'a');
    console.log(`[finch-install] starting ${name}: ${cmd.join(' ')}`);
    const env = [
      `PATH=/usr/libexec/finch:/usr/libexec/finch/cni/bin:${process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'}`,
    ];
    const child = spawn('sudo', ['env', ...env, ...cmd], {
      stdio: ['ignore', out, out],
      detached: true,
    });
    child.unref();
  };

  launch('containerd', ['containerd']);
  waitForSocket('/run/containerd/containerd.sock', 60_000, [
    join(logDir, 'containerd.log'),
  ]);

  // Bind buildkitd to the socket path the finch CLI hard-codes
  // (pkg/path/finch_linux.go BuildkitSocketPath -> /var/lib/finch/buildkit).
  // The finch wrapper sets BUILDKIT_HOST for nerdctl from this path, so a
  // mismatch here causes finch build to silently fail to dial buildkit.
  launch('finch-buildkit', [
    '/usr/libexec/finch/buildkitd',
    '--config',
    '/etc/finch/buildkit/buildkitd.toml',
    '--addr',
    'unix:///var/lib/finch/buildkit/buildkitd.sock',
  ]);
  launch('finch-soci', [
    '/usr/libexec/finch/soci-snapshotter-grpc',
    '--config',
    '/etc/finch/soci/soci-snapshotter-grpc.toml',
    '--root',
    '/var/lib/finch/soci',
  ]);
  launch('finch-daemon', [
    '/usr/libexec/finch/finch-daemon',
    '--debug',
    '--config-file',
    '/etc/finch/nerdctl/nerdctl.toml',
    '--socket-addr',
    '/run/finch.sock',
  ]);
  waitForSocket('/run/finch.sock', 60_000, [
    join(logDir, 'finch-daemon.log'),
    join(logDir, 'finch-buildkit.log'),
    join(logDir, 'finch-soci.log'),
  ]);
  waitForSocket('/var/lib/finch/buildkit/buildkitd.sock', 60_000, [
    join(logDir, 'finch-buildkit.log'),
  ]);
  // The daemon sockets default to mode 0600 owned by root. The smoke-test
  // process runs unprivileged, but `finch build` dials buildkit directly
  // (via nerdctl's BUILDKIT_HOST resolution) — so both sockets need to be
  // reachable by the calling user.
  sh('sudo chmod 666 /run/finch.sock');
  sh('sudo chmod 666 /var/lib/finch/buildkit/buildkitd.sock');
  sh('sudo chmod 666 /run/containerd/containerd.sock');
};

/**
 * Install Finch on Linux from the upstream .deb package, pull in its
 * containerd/runc dependencies, and start the finch-daemon so the
 * Docker-compatible socket is ready before any generator tries to
 * invoke `finch build` / `finch push` / etc.
 *
 * Uses systemd when the runner has a live dbus; otherwise launches the
 * daemon binaries directly (CodeBuild container runners have systemctl
 * on PATH but no init system actually running).
 */
export const installFinch = (): void => {
  if (process.platform !== 'linux') {
    throw new Error(
      `installFinch is only supported on Linux (got ${process.platform})`,
    );
  }
  if (!isOnPath('sudo') || !isOnPath('dpkg') || !isOnPath('apt-get')) {
    throw new Error(
      'installFinch requires sudo, dpkg, and apt-get — only Debian/Ubuntu hosts are supported',
    );
  }

  if (isOnPath('finch')) {
    console.log('[finch-install] finch already on PATH, skipping install');
  } else {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const url = `https://github.com/runfinch/finch/releases/download/v${FINCH_VERSION}/runfinch-finch_${FINCH_VERSION}_${arch}.deb`;
    const debPath = join(tmpdir(), `finch-${FINCH_VERSION}-${arch}.deb`);
    sh(`curl -fsSL -o "${debPath}" "${url}"`);
    sh('sudo apt-get update -y');
    // The deb depends on containerd >= 1.7.24 and runc >= 1.1.5; let
    // dpkg pull them in via apt-get -f after the unsatisfied install.
    sh(`sudo dpkg -i "${debPath}" || sudo apt-get install -fy`);
  }

  if (hasRunningSystemd()) {
    console.log('[finch-install] systemd is active, using systemctl');
    startDaemonsViaSystemd();
  } else {
    console.log(
      '[finch-install] no live systemd bus, launching daemons directly',
    );
    startDaemonsManually();
  }

  // finch CLI execs /usr/libexec/finch/nerdctl, which then forks buildctl
  // via PATH lookup. /usr/libexec/finch isn't on the default PATH, so any
  // downstream invocation (smoke test, generator targets) needs it added.
  const finchLibexec = '/usr/libexec/finch';
  if (!process.env.PATH?.split(':').includes(finchLibexec)) {
    process.env.PATH = `${finchLibexec}:${process.env.PATH ?? ''}`;
  }

  // Smoke-check the daemon is reachable before handing back to the test.
  sh('finch version');
  sh('finch info');

  // Run a real `finch build` to surface daemon/buildkit/binfmt issues here
  // rather than burying them inside the silent nx:run-commands docker target.
  // The generated targets pass `--platform linux/arm64`, which on x86_64
  // CodeBuild runners requires QEMU binfmt_misc registration in the kernel.
  smokeCheckFinchBuild();
};

const smokeCheckFinchBuild = (): void => {
  const buildDir = join(tmpdir(), 'finch-smoke-build');
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(
    join(buildDir, 'Dockerfile'),
    'FROM --platform=$TARGETPLATFORM public.ecr.aws/docker/library/alpine:3.20\nRUN echo hi\n',
  );
  runFinchAndReport(['images']);
  runFinchAndReport(['pull', 'public.ecr.aws/docker/library/alpine:3.20']);
  const buildResult = runFinchAndReport(
    ['build', '--progress=plain', '-t', 'finch-smoke:native', '.'],
    buildDir,
  );
  if (buildResult.status !== 0) {
    dumpFinchLogs();
    throw new Error(
      `finch build smoke check failed with exit ${buildResult.status}`,
    );
  }
};

const runFinchAndReport = (
  args: string[],
  cwd?: string,
): { status: number | null; stdout: string; stderr: string } => {
  return runAndReport('finch', args, cwd);
};

const runAndReport = (
  bin: string,
  args: string[],
  cwd?: string,
): { status: number | null; stdout: string; stderr: string } => {
  console.log(`[finch-install] $ ${bin} ${args.join(' ')}`);
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf-8',
  });
  const tag = `${bin} ${args[0] ?? ''}`.trim();
  console.log(
    `[finch-install] ${tag} exit code: ${result.status} signal: ${result.signal}`,
  );
  console.log(
    `[finch-install] ${tag} STDOUT (${(result.stdout ?? '').length} bytes):`,
  );
  console.log(result.stdout ?? '<null>');
  console.log(
    `[finch-install] ${tag} STDERR (${(result.stderr ?? '').length} bytes):`,
  );
  console.log(result.stderr ?? '<null>');
  if (result.error) {
    console.log('[finch-install] spawn error:', result.error);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

const dumpFinchLogs = (): void => {
  const logDir = join(tmpdir(), 'nx-plugin-for-aws', 'finch-logs');
  for (const name of [
    'finch-daemon',
    'finch-buildkit',
    'finch-soci',
    'containerd',
  ]) {
    const logPath = join(logDir, `${name}.log`);
    if (existsSync(logPath)) {
      console.error(`[finch-install] ----- ${logPath} -----`);
      try {
        console.error(readFileSync(logPath, 'utf-8'));
      } catch (re) {
        console.error(`(failed to read: ${(re as Error).message})`);
      }
    }
  }
};

/**
 * onProjectCreate hook for the finch smoke test: switches the workspace's
 * container engine to finch by editing aws-nx-plugin.config.mts in place.
 * The preset writes `containers: { engine: 'docker' }` (or whatever was
 * inferred at create time) — we replace that with finch so every generator
 * downstream sees the override.
 */
export const setFinchAsContainerEngine = (projectRoot: string): void => {
  const configPath = join(projectRoot, 'aws-nx-plugin.config.mts');
  if (!existsSync(configPath)) {
    throw new Error(`Expected ${configPath} to exist after workspace creation`);
  }
  const original = readFileSync(configPath, 'utf-8');
  const updated = original.replace(
    /containers:\s*\{\s*engine:\s*'[^']*'\s*\}/,
    "containers: { engine: 'finch' }",
  );
  if (updated === original) {
    throw new Error(
      `Failed to rewrite containers.engine in ${configPath}:\n${original}`,
    );
  }
  writeFileSync(configPath, updated, { encoding: 'utf-8' });
  console.log(`[finch-install] set containers.engine=finch in ${configPath}`);
};
