/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { startMcpServer } from './index.js';

/**
 * Entry point for the `mcp-inspect` target, which runs the server from source
 * with live reload. The published server is `@aws/nx-plugin-mcp`, whose bundled
 * entry point resolves `generators.json` relative to itself and so only works
 * once built.
 */
void (async () => {
  try {
    await startMcpServer();
  } catch (e) {
    console.error(e);
  }
})();
