/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finalizes the dist output after the dual ESM/CJS swc builds:
 * - copies root-level package assets (package.json, manifests, docs)
 * - mirrors the JSON manifests into `cjs/` and drops a `cjs/package.json`
 *   marked `"type": "commonjs"` so Node treats the CommonJS output as CJS
 *   (and so relative `require('../../package.json')` from the CJS sources
 *   resolves to the real manifest) even though the package root is
 *   `"type": "module"`
 */
import { glob } from 'node:fs/promises';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = join(projectRoot, '..', '..', 'dist', 'packages', 'nx-plugin');

// Copy hand-authored declaration files (e.g. schema.d.ts) that swc's
// `--copy-files` skips and tsc does not re-emit.
for (const dir of ['src', 'sdk']) {
  for await (const file of glob(`${dir}/**/*.d.ts`, { cwd: projectRoot })) {
    const dest = join(distRoot, file);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(projectRoot, file), dest);
  }
}

const rootAssets = [
  'package.json',
  'generators.json',
  'executors.json',
  'README.md',
  'LICENSE',
  'LICENSE-THIRD-PARTY',
  'NOTICE',
];

for (const asset of rootAssets) {
  const src = join(projectRoot, asset);
  if (existsSync(src)) {
    copyFileSync(src, join(distRoot, asset));
  }
}

// The CJS sources live under `cjs/src` and `cjs/sdk`, so their relative
// `require('../../<manifest>')` calls resolve against `cjs/`. Mirror the JSON
// manifests there, and write a minimal `cjs/package.json` marker that tells
// Node to load the CommonJS output as CJS even though the package root is
// `"type": "module"`. It carries only name/version (read at runtime via
// `require('../../package.json')`) — keeping it minimal avoids nesting a second
// full manifest (with its own `exports`) inside the published package.
mkdirSync(join(distRoot, 'cjs'), { recursive: true });

for (const manifest of ['generators.json', 'executors.json']) {
  const src = join(projectRoot, manifest);
  if (existsSync(src)) {
    copyFileSync(src, join(distRoot, 'cjs', manifest));
  }
}

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
writeFileSync(
  join(distRoot, 'cjs', 'package.json'),
  `${JSON.stringify(
    { name: pkg.name, version: pkg.version, type: 'commonjs' },
    null,
    2,
  )}\n`,
);
