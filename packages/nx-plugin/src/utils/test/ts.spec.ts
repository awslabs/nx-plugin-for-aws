/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { Project, createProjectSync, ts } from '@ts-morph/bootstrap';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createTreeUsingTsSolutionSetup } from '../test';

/**
 * Utility for verifying typescript files compile
 * This allows the reuse of a single @ts-morph/bootstrap Project for multiple tests.
 * It's recommended to reuse over multiple tests when there are dependencies, since
 * loading dependencies into the project adds quite a lot of overhead.
 */
export class TypeScriptVerifier {
  private project: Project;

  private rootDir = '/workspace';

  constructor(dependencies: string[] = []) {
    this.project = createProjectSync({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        strict: true,
        noUnusedLocals: true,
        noImplicitReturns: true,
        noImplicitOverride: true,
        noFallthroughCasesInSwitch: true,
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
      const filePath = path.join(this.rootDir, dependencyDir);
      if (!project.getSourceFile(filePath)) {
        project.createSourceFile(filePath, fs.readFileSync(dir, 'utf-8'), {
          scriptKind: ts.ScriptKind.External,
        });
      }
    }
  };

  private resolveDependencyPath = (dependency: string): string => {
    try {
      // First try using require.resolve
      return require.resolve(dependency);
    } catch (error) {
      // Fallback to using pnpm list command to find the dependency path
      const pnpmData = JSON.parse(
        execSync(`pnpm list --depth 1000 --json ${dependency}`, {
          encoding: 'utf-8',
          stdio: 'pipe',
          cwd: path.resolve(__dirname, '../../../../../'),
          maxBuffer: 50 * 1024 * 1024, // 50 MB
        }),
      );

      // Navigate through the pnpm output structure to find the dependency path
      const findDependencyPath = (obj: any): string | null => {
        if (obj.dependencies && obj.dependencies[dependency]) {
          return obj.dependencies[dependency].path;
        }
        if (obj.devDependencies && obj.devDependencies[dependency]) {
          return obj.devDependencies[dependency].path;
        }

        // Recursively search through dependencies
        for (const dep of Object.values(obj.dependencies || {})) {
          if (typeof dep === 'object' && dep !== null) {
            const result = findDependencyPath(dep);
            if (result) return result;
          }
        }

        for (const dep of Object.values(obj.devDependencies || {})) {
          if (typeof dep === 'object' && dep !== null) {
            const result = findDependencyPath(dep);
            if (result) return result;
          }
        }

        return null;
      };

      for (const project of pnpmData) {
        const dependencyPath = findDependencyPath(project);
        if (dependencyPath) {
          return dependencyPath + '/';
        }
      }

      throw new Error(
        `Could not find dependency ${dependency} in pnpm list output`,
      );
    }
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
        this.project.createSourceFile(
          path.join(this.rootDir, p),
          tree.read(p, 'utf-8'),
        ),
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
        this.project.removeSourceFile(path.join(this.rootDir, p));
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
      'import { createProjectSync } from "@ts-morph/bootstrap"; createProjectSync()',
    );
    verifierWithDeps.expectTypeScriptToCompile(tree, ['test.ts']);
  });

  it('should throw for invalid typescript with a dependency', () => {
    tree.write(
      'test.ts',
      'import { createProjectSync } from "@ts-morph/bootstrap"; createProjectSync(42)',
    );
    expect(() =>
      verifierWithDeps.expectTypeScriptToCompile(tree, ['test.ts'], true),
    ).toThrow();
  });
});
