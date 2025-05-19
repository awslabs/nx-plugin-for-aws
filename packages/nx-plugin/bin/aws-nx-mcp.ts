#!/usr/bin/env node
/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { startMcpServer } from '../src/mcp-server';

void (async () => {
  try {
    await startMcpServer();
  } catch (e) {
    console.error(e);
  }
})();
