/**
 * Clears the runtime-config dist dir before every build so that removed
 * modules don't leave behind stale entries in `connection.json` /
 * `agentcore.json` / per-entry leaf files.
 *
 * Invoked by the `reset-runtime-config` nx target, which the `build`
 * target depends on.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distDir = process.env.DIST_DIR;
if (!distDir) {
  throw new Error('DIST_DIR environment variable is required');
}

// `runtime-config.json` starts as `{}` so the reader Terraform module can
// assume the file exists.
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'runtime-config.json'), '{}');

// Clear and recreate the per-entry leaf-file tree.
const runtimeConfigDir = join(distDir, 'runtime-config');
rmSync(runtimeConfigDir, { recursive: true, force: true });
mkdirSync(join(runtimeConfigDir, 'entries'), { recursive: true });
