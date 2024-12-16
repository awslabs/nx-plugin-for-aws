/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from 'nx/src/devkit-testing-exports';
import { typeSafeApiReactGenerator } from './generator';

describe('type-safe-api react generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();

    // Mock frontend project configuration
    tree.write(
      'apps/frontend/project.json',
      JSON.stringify({
        name: 'frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
      })
    );

    // Mock hooks library project configuration with required apiName metadata
    tree.write(
      'libs/test-api-hooks/project.json',
      JSON.stringify({
        name: 'test-api-hooks',
        root: 'libs/test-api-hooks',
        sourceRoot: 'libs/test-api-hooks/src',
        metadata: {
          apiName: 'TestApi',
        },
      })
    );

    // Mock main.tsx file
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { App } from './app';
import { BrowserRouter } from 'react-router-dom';

export function Main() {
  return <BrowserRouter><App /></BrowserRouter>;
}
`
    );
  });

  it('should generate api hooks provider files', async () => {
    await typeSafeApiReactGenerator(tree, {
      frontendProject: 'frontend',
      hooksLibraryProject: 'test-api-hooks',
      auth: 'None',
    });

    // Verify generated files
    expect(
      tree.exists('apps/frontend/src/components/TestApiHooksProvider.tsx')
    ).toBeTruthy();
    expect(
      tree.exists('apps/frontend/src/hooks/test-api/useApi.ts')
    ).toBeTruthy();

    expect(
      tree.read(
        'apps/frontend/src/components/TestApiHooksProvider.tsx',
        'utf-8'
      )
    ).toMatchSnapshot('TestApiHooksProvider.tsx');
    expect(
      tree.read(
        'apps/frontend/src/hooks/test-api/useApi.ts',
        'utf-8'
      )
    ).toMatchSnapshot('useApi.ts');
  });

  it('should modify main.tsx correctly', async () => {
    await typeSafeApiReactGenerator(tree, {
      frontendProject: 'frontend',
      hooksLibraryProject: 'test-api-hooks',
      auth: 'None',
    });

    const mainTsxContent = tree.read('apps/frontend/src/main.tsx', 'utf-8');

    // Verify imports and component wrapper were added
    expect(mainTsxContent).toContain(
      "import TestApiHooksProvider from './components/TestApiHooksProvider'"
    );
    expect(mainTsxContent).toMatchSnapshot('main.tsx');
  });

  it('should add required dependencies', async () => {
    await typeSafeApiReactGenerator(tree, {
      frontendProject: 'frontend',
      hooksLibraryProject: 'test-api-hooks',
      auth: 'None',
    });

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Verify dependencies were added
    expect(packageJson.dependencies['@tanstack/react-query']).toBeDefined();
    expect(packageJson.dependencies['@aws-northstar/ui']).toBeDefined();
  });

  it('should throw error if hooks library project does not have apiName metadata', async () => {
    // Mock hooks library without apiName metadata
    tree.write(
      'libs/test-api-hooks/project.json',
      JSON.stringify({
        name: 'test-api-hooks',
        root: 'libs/test-api-hooks',
        sourceRoot: 'libs/test-api-hooks/src',
      })
    );

    await expect(
      typeSafeApiReactGenerator(tree, {
        frontendProject: 'frontend',
        hooksLibraryProject: 'test-api-hooks',
        auth: 'None',
      })
    ).rejects.toThrow(/does not appear to be a Type Safe API generated hooks project/);
  });

  it('should throw error if main.tsx does not exist', async () => {
    tree.delete('apps/frontend/src/main.tsx');

    await expect(
      typeSafeApiReactGenerator(tree, {
        frontendProject: 'frontend',
        hooksLibraryProject: 'test-api-hooks',
        auth: 'None',
      })
    ).rejects.toThrow();
  });

  it('should throw error if App component is not found in main.tsx', async () => {
    tree.write(
      'apps/frontend/src/main.tsx',
      `
export function Main() {
  return <BrowserRouter>No App component</BrowserRouter>;
}
`
    );

    await expect(
      typeSafeApiReactGenerator(tree, {
        frontendProject: 'frontend',
        hooksLibraryProject: 'test-api-hooks',
        auth: 'None',
      })
    ).rejects.toThrow(/Could not locate App component/);
  });

  it('should handle IAM auth option', async () => {
    await typeSafeApiReactGenerator(tree, {
      frontendProject: 'frontend',
      hooksLibraryProject: 'test-api-hooks',
      auth: 'IAM',
    });

    const hookContent = tree.read(
      'apps/frontend/src/hooks/test-api/useApi.ts',
      'utf-8'
    );

    expect(hookContent).toMatchSnapshot('useApi-IAM.ts');
  });
});
