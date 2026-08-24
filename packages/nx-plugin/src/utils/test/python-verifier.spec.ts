/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../test';
import { PythonVerifier } from './py.spec';
import { PY_CLIENT_VERIFIER_DEPENDENCIES } from './python-dependencies';

// A few tests for the test utility as a sanity check, mirroring ts.spec.ts.
describe('PythonVerifier', () => {
  let tree: Tree;
  let verifier: PythonVerifier;

  beforeAll(() => {
    verifier = new PythonVerifier(PY_CLIENT_VERIFIER_DEPENDENCIES);
  });

  afterAll(async () => {
    await verifier.shutdown();
  });

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const writePackage = (body: string, module = 'thing.py') => {
    tree.write(
      'pkg/__init__.py',
      `from .${module.replace('.py', '')} import *`,
    );
    tree.write(`pkg/${module}`, body);
    return ['pkg/__init__.py', `pkg/${module}`];
  };

  it('should not throw for valid Python', async () => {
    const paths = writePackage('MY_NUMBER: int = 1\n');
    await verifier.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' });
  });

  it('should throw for Python that does not parse', async () => {
    const paths = writePackage('def broken(:\n');
    await expect(
      verifier.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' }),
    ).rejects.toThrow(/compile failed/);
  });

  it('should throw for Python that fails to import', async () => {
    const paths = writePackage('raise RuntimeError("boom")\n');
    await expect(
      verifier.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' }),
    ).rejects.toThrow(/boom/);
  });

  // Type errors parse and import fine, so only the type check catches them.
  it('should throw for Python that does not type check', async () => {
    const paths = writePackage('MY_NUMBER: int = "a string"\n');
    await expect(
      verifier.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' }),
    ).rejects.toThrow(/type check failed/);
  });

  it('should not type check when asked not to', async () => {
    const paths = writePackage('MY_NUMBER: int = "a string"\n');
    await verifier.expectPythonToCompile(tree, paths, 'pkg', {
      pkg: 'pkg',
      typeCheck: false,
    });
  });

  // The dependencies a generated client imports resolve, so a type error
  // involving them is caught rather than dismissed as an unresolved import.
  it('should resolve the vended dependencies when type checking', async () => {
    const paths = writePackage(
      [
        'import httpx',
        'from pydantic import BaseModel',
        '',
        '',
        'class Thing(BaseModel):',
        '    name: str',
        '',
        '',
        'def build() -> httpx.Client:',
        '    return httpx.Client()',
        '',
      ].join('\n'),
    );
    await verifier.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' });
  });

  // Dependencies are the caller's to choose, mirroring TypeScriptVerifier: a
  // worker only resolves what it was asked to install.
  describe('dependencies', () => {
    it('should resolve a dependency it was given', async () => {
      const scoped = new PythonVerifier(PY_CLIENT_VERIFIER_DEPENDENCIES);
      try {
        const paths = writePackage('import httpx\n\nCLIENT = httpx.Client\n');
        await scoped.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' });
      } finally {
        await scoped.shutdown();
      }
    });

    it('should not resolve a dependency it was not given', async () => {
      const bare = new PythonVerifier([]);
      try {
        const paths = writePackage('import httpx\n\nCLIENT = httpx.Client\n');
        await expect(
          bare.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' }),
        ).rejects.toThrow(/httpx/);
      } finally {
        await bare.shutdown();
      }
    });
  });

  describe('typeCheckUsage', () => {
    beforeEach(async () => {
      const paths = writePackage(
        [
          'from pydantic import BaseModel',
          '',
          '',
          'class Thing(BaseModel):',
          '    name: str',
          '',
          '',
          'def take(thing: Thing) -> str:',
          '    return thing.name',
          '',
        ].join('\n'),
      );
      await verifier.expectPythonToCompile(tree, paths, 'pkg', { pkg: 'pkg' });
    });

    it('should report no diagnostics for valid usage', async () => {
      const diagnostics = await verifier.typeCheckUsage(
        [
          'from .thing import Thing, take',
          '',
          '',
          'def usage() -> None:',
          '    _name: str = take(Thing(name="a"))',
          '',
        ].join('\n'),
        'pkg',
      );
      expect(diagnostics).toEqual([]);
    });

    it('should report diagnostics for invalid usage', async () => {
      const diagnostics = await verifier.typeCheckUsage(
        [
          'from .thing import take',
          '',
          '',
          'def usage() -> None:',
          '    _name: int = take("not a Thing")',
          '',
        ].join('\n'),
        'pkg',
      );
      expect(diagnostics.join('\n')).toMatch(/invalid-argument-type/);
      expect(diagnostics.join('\n')).toMatch(/invalid-assignment/);
    });
  });
});
