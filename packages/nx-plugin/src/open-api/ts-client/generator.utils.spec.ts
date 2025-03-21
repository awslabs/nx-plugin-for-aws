/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createProjectSync, Project, ts } from '@ts-morph/bootstrap';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { Mock } from 'vitest';
import { importTypeScriptModule } from '../../utils/js';

export const baseUrl = 'https://example.com';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility for verifying typescript files compile
 * This allows the reuse of a single @ts-morph/bootstrap Project for multiple tests.
 * It's recommended to reuse over multiple tests when there are dependencies, since
 * loading dependencies into the project adds quite a lot of overhead.
 */
export class TypeScriptVerifier {
  private project: Project;

  constructor(dependencies: string[] = []) {
    this.project = createProjectSync({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        strict: true,
      },
    });

    // Add dependencies (and their transitive dependencies) to the memory filesystem
    dependencies.forEach((dependency) => {
      this.initialiseDependencyInProject(dependency, this.project);
    });
  }

  private copyIntoProjectRecursive = (
    dependencyRootPath: string,
    dependencyDir: string,
    project: Project,
  ) => {
    const dir = path.join(dependencyRootPath, dependencyDir);

    if (fs.lstatSync(dir).isDirectory()) {
      fs.readdirSync(dir).map((f) =>
        this.copyIntoProjectRecursive(
          dependencyRootPath,
          path.join(dependencyDir, f),
          project,
        ),
      );
    } else {
      if (!project.getSourceFile(dependencyDir)) {
        project.createSourceFile(dependencyDir, fs.readFileSync(dir, 'utf-8'), {
          scriptKind: ts.ScriptKind.External,
        });
      }
    }
  };

  private resolveDependencyPath = (dependency: string): string => {
    // NB: this won't work for @types/xxx type dependencies but it's good enough for our test use cases
    return require.resolve(dependency);
  };

  private initialiseDependencyInProject = (
    dependency: string,
    project: Project,
  ) => {
    // Resolve the dependency in this workspace
    const dependencyPath = this.resolveDependencyPath(dependency);
    const dependencyDir = `node_modules/${dependency}/`;
    const dependencyRootPath = dependencyPath.split(`/${dependencyDir}`)[0];

    // Recursively write all files from the dependency into the memory filesystem project
    this.copyIntoProjectRecursive(dependencyRootPath, dependencyDir, project);

    // Initialise transitive dependencies
    const packageJsonPath = path.join(
      dependencyRootPath,
      dependencyDir,
      'package.json',
    );

    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      [...Object.keys(packageJson?.dependencies ?? {})].forEach(
        (transitiveDependency) => {
          this.initialiseDependencyInProject(transitiveDependency, project);
        },
      );
    }
  };

  /**
   * Verify that the given typescript files in the tree compile
   */
  public expectTypeScriptToCompile = (
    tree: Tree,
    paths: string[],
    silent = false,
  ) => {
    try {
      const sourceFilesToTypeCheck = paths.map((p) =>
        this.project.createSourceFile(p, tree.read(p, 'utf-8')),
      );

      const program = this.project.createProgram();

      const diagnostics = [
        ...sourceFilesToTypeCheck.flatMap((s) =>
          program.getSemanticDiagnostics(s),
        ),
        ...sourceFilesToTypeCheck.flatMap((s) =>
          program.getSyntacticDiagnostics(s),
        ),
      ];

      if (diagnostics.length > 0 && !silent) {
        console.log(
          this.project.formatDiagnosticsWithColorAndContext(diagnostics),
        );
      }
      expect(diagnostics).toHaveLength(0);
    } finally {
      // Always unload the source files to reset our project
      paths.forEach((p) => {
        this.project.removeSourceFile(p);
      });
    }
  };
}

export const expectTypeScriptToCompile = (
  tree: Tree,
  paths: string[],
  silent = false,
) => {
  const verifier = new TypeScriptVerifier();
  verifier.expectTypeScriptToCompile(tree, paths, silent);
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

  const verifierWithDeps = new TypeScriptVerifier(['@ts-morph/bootstrap']);

  it('should not throw for valid typescript with a dependency', () => {
    tree.write(
      'test.ts',
      'import { createProjectSync } from "@ts-morph/bootstrap"; const project = createProjectSync()',
    );
    verifierWithDeps.expectTypeScriptToCompile(tree, ['test.ts']);
  });

  it('should throw for invalid typescript with a dependency', () => {
    tree.write(
      'test.ts',
      'import { createProjectSync } from "@ts-morph/bootstrap"; const project = createProjectSync(42)',
    );
    expect(() =>
      verifierWithDeps.expectTypeScriptToCompile(tree, ['test.ts'], true),
    ).toThrow();
  });
});
