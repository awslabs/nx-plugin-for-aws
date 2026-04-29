/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'rolldown';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  input: path.resolve(__dirname, 'src/index.ts'),
  output: {
    dir: path.resolve(__dirname, '../../dist/packages/nx-plugin-mcp/bin'),
    entryFileNames: 'aws-nx-mcp.js',
    format: 'cjs',
    // Inline every `await import()` back into the main chunk. Without this,
    // rolldown emits separate chunks for the unified/remark ESM deps the
    // guide pipeline loads — but the published MCP binary ships alone
    // (no node_modules beside it), so those separate chunks would fail
    // to resolve at runtime. Turning code splitting off gives us a single
    // self-contained CJS file with the whole dep graph baked in.
    inlineDynamicImports: true,
    codeSplitting: false,
  },
  platform: 'node',
  external: [/^node:/],
});
