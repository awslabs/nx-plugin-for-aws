/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createProjectSync } from '@ts-morph/bootstrap';
import ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Mock } from 'vitest';
import { importTypeScriptModule } from '../../utils/js';

export const baseUrl = 'https://example.com';

export const expectTypeScriptToCompile = (
  tree: Tree,
  paths: string[],
  silent = false,
) => {
  const project = createProjectSync({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      strict: true,
    },
  });
  paths.forEach((p) => {
    project.createSourceFile(p, tree.read(p, 'utf-8'));
  });

  const program = project.createProgram();

  const diagnostics = [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ];

  if (diagnostics.length > 0 && !silent) {
    console.log(project.formatDiagnosticsWithColorAndContext(diagnostics));
  }
  expect(diagnostics).toHaveLength(0);
};

export const callGeneratedClient = async (
  clientModule: string,
  mockFetch: Mock<any, any>,
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
  mockFetch: Mock<any, any>,
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
): Mock<any, any> => {
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

// A couple of tests for the test utility as a sanity check
describe('expectTypeScriptToCompile', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should not throw for valid TypeScript', () => {
    tree.write('test.ts', 'const myNumber: number = 1;');
    expectTypeScriptToCompile(tree, ['test.ts']);
  });

  it('should throw for invalid TypeScript', () => {
    tree.write('test.ts', 'const myNumber: number = "string";');
    expect(() => expectTypeScriptToCompile(tree, ['test.ts'], true)).toThrow();
  });
});
