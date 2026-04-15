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
    entryFileNames: 'aws-nx-mcp.cjs',
    format: 'cjs',
  },
  platform: 'node',
  external: [/^node:/],
});
