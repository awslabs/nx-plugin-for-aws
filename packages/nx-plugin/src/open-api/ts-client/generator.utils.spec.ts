/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Mock } from 'vitest';
import { importTypeScriptModule } from '../../utils/js';

export const baseUrl = 'https://example.com';

export const callGeneratedClient = async (
  clientModule: string,
  mockFetch: Mock<any>,
  op: string,
  parameters?: any,
): Promise<any> => {
  const { TestApi } = await importTypeScriptModule<any>(clientModule);
  const client = new TestApi({ url: baseUrl, fetch: mockFetch });
  const clientMethod = op.split('.').reduce((m, opPart) => m[opPart], client);
  return await clientMethod(parameters);
};

export const callGeneratedClientStreaming = async (
  clientModule: string,
  mockFetch: Mock<any>,
  op: string,
  parameters?: any,
): Promise<AsyncIterableIterator<any>> => {
  const { TestApi } = await importTypeScriptModule<any>(clientModule);
  const client = new TestApi({ url: baseUrl, fetch: mockFetch });
  const clientMethod = op.split('.').reduce((m, opPart) => m[opPart], client);
  return clientMethod(parameters);
};

export const mockStreamingFetch = (
  status: number,
  chunks: any[],
): Mock<any> => {
  const mockFetch = vi.fn();

  let i = 0;

  const mockReader = vi.fn();
  mockReader.mockReturnValue({
    read: vi.fn().mockImplementation(() => {
      const value = chunks[i];
      const done = i >= chunks.length;
      i++;
      return {
        done,
        value,
      };
    }),
  });

  mockFetch.mockResolvedValue({
    status,
    body: {
      pipeThrough: () => ({
        getReader: mockReader,
      }),
      getReader: () => mockReader,
    },
  });

  return mockFetch;
};

describe('openapi test utils', () => {
  it('should have a test', () => {
    // A test is required for this to be a .spec.ts file.
    // We want it to be a .spec.ts file as these are utilities only to be used in tests.
  });
});
