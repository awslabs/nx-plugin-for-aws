/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { rolldown } from 'rolldown';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths to lightweight shims that replace heavy modules
const nxPluginSrc = path.resolve(__dirname, '../nx-plugin/src');
const nxShim = path.resolve(__dirname, 'src/shims/nx.ts');
const iacShim = path.resolve(__dirname, 'src/shims/iac.ts');

const distRoot = path.resolve(__dirname, '../../dist/packages/nx-plugin-mcp');

async function main() {
  // 1. Bundle the MCP server into a single CJS file
  const bundle = await rolldown({
    input: path.resolve(__dirname, 'src/index.ts'),
    platform: 'node',
    external: [/^node:/],
    resolve: {
      extensions: ['.ts', '.js', '.json'],
      alias: {
        // Redirect heavy imports to lightweight shims that avoid @nx/devkit
        [path.resolve(nxPluginSrc, 'utils/nx')]: nxShim,
        [path.resolve(nxPluginSrc, 'utils/iac')]: iacShim,
      },
    },
  });
  const { output } = await bundle.generate({ format: 'cjs' });
  const code = output[0].code;

  // 2. Write the bundled file
  const binDir = path.join(distRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const outFile = path.join(binDir, 'aws-nx-mcp.cjs');
  fs.writeFileSync(outFile, '#!/usr/bin/env node\n' + code, 'utf-8');
  fs.chmodSync(outFile, 0o755);

  // 3. Copy package.json, README, and LICENSE
  for (const file of ['package.json', 'README.md', 'LICENSE']) {
    const src = path.resolve(__dirname, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(distRoot, file));
    }
  }

  // 4. Copy generators.json
  fs.copyFileSync(
    path.resolve(__dirname, '../nx-plugin/generators.json'),
    path.join(distRoot, 'generators.json'),
  );

  // 5. Copy all schema.json files (needed at runtime for generator info)
  const nxPluginRoot = path.resolve(__dirname, '../nx-plugin');
  copySchemaFiles(path.join(nxPluginRoot, 'src'), path.join(distRoot, 'src'));

  const sizeKB = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`Bundled MCP server: ${sizeKB} KB -> ${outFile}`);
}

function copySchemaFiles(srcDir, destDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copySchemaFiles(srcPath, destPath);
    } else if (entry.name === 'schema.json') {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
