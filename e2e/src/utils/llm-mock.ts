/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createMock, type MockServer } from 'llm-mock-server';

export async function startLlmMock(port: number): Promise<MockServer> {
  const server = await createMock({ port, host: '127.0.0.1' });
  server.fallback('The answer is 42.');
  return server;
}
