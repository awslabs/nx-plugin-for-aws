/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { cognitoAuthGenerator } from './generator';
import { CognitoAuthGeneratorSchema } from './schema';
describe('cognito-auth generator', () => {
  let tree: Tree;
  const options: CognitoAuthGeneratorSchema = {
    project: 'test-project',
    cognitoDomain: 'test',
    allowSignup: true,
  };
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    // Set up a mock project structure
    tree.write(
      'packages/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        sourceRoot: 'packages/test-project/src',
      })
    );
  });
  it('should generate files', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { BrowserRouter } from 'react-router-dom';

      export function App() {
        return (
          <RuntimeConfigProvider>
            <BrowserRouter>Hello World</BrowserRouter>
          </RuntimeConfigProvider>
        );
      }
    `
    );
    await cognitoAuthGenerator(tree, options);
    // Verify component files are generated
    expect(
      tree.exists('packages/test-project/src/components/CognitoAuth/index.tsx')
    ).toBeTruthy();
    // Verify shared constructs files are generated
    expect(
      tree.exists('packages/common/constructs/src/core/user-identity.ts')
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/core/index.ts')
    ).toBeTruthy();
    // Create snapshot of the generated files
    expect(
      tree
        .read('packages/test-project/src/components/CognitoAuth/index.tsx')
        .toString()
    ).toMatchSnapshot('cognito-auth-component');
    expect(
      tree.read('packages/common/constructs/src/core/index.ts').toString()
    ).toMatchSnapshot('identity-index');
    expect(
      tree
        .read('packages/common/constructs/src/core/user-identity.ts')
        .toString()
    ).toMatchSnapshot('user-identity');
  });
  it('should update main.tsx when RuntimeConfigProvider exists', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { BrowserRouter } from 'react-router-dom';

      export function App() {
        return (
          <RuntimeConfigProvider>
            <BrowserRouter>Hello World</BrowserRouter>
          </RuntimeConfigProvider>
        );
      }
    `
    );
    await cognitoAuthGenerator(tree, options);
    const mainTsxContent = tree
      .read('packages/test-project/src/main.tsx')
      .toString();
    // Verify CognitoAuth import is added
    expect(mainTsxContent).toContain(
      "import CognitoAuth from './components/CognitoAuth'"
    );
    // Verify CognitoAuth component is wrapped around children
    expect(mainTsxContent).toContain('<CognitoAuth>');
    expect(mainTsxContent).toContain('</CognitoAuth>');
    // Create snapshot of the modified main.tsx
    expect(mainTsxContent).toMatchSnapshot('main-tsx-with-runtime-config');
  });
  it('should handle main.tsx without RuntimeConfigProvider', async () => {
    // Setup main.tsx without RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      export function App() {
        return (
          <div>Hello World</div>
        );
      }
    `
    );
    await expect(
      async () => await cognitoAuthGenerator(tree, options)
    ).rejects.toThrowError();
  });
  it('should handle missing main.tsx', async () => {
    await expect(
      async () => await cognitoAuthGenerator(tree, options)
    ).rejects.toThrowError();
  });
  it('should update shared constructs index.ts', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
        import { RuntimeConfigProvider } from './components/RuntimeConfig';
        import { BrowserRouter } from 'react-router-dom';

        export function App() {
          return (
            <RuntimeConfigProvider>
              <BrowserRouter>Hello World</BrowserRouter>
            </RuntimeConfigProvider>
          );
        }
      `
    );
    // Setup initial shared constructs index
    tree.write(
      'packages/common/constructs/src/index.ts',
      'export const dummy = true;'
    );
    await cognitoAuthGenerator(tree, options);
    const indexContent = tree
      .read('packages/common/constructs/src/core/index.ts')
      .toString();
    // Verify identity export is added
    expect(indexContent).toContain('export * from "./user-identity.js"');
    // Create snapshot of the modified index
    expect(indexContent).toMatchSnapshot('common/constructs-index');
  });
  it('should add required dependencies', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
        import { RuntimeConfigProvider } from './components/RuntimeConfig';
        import { BrowserRouter } from 'react-router-dom';

        export function App() {
          return (
            <RuntimeConfigProvider>
              <BrowserRouter>Hello World</BrowserRouter>
            </RuntimeConfigProvider>
          );
        }
      `
    );
    await cognitoAuthGenerator(tree, options);
    // Read package.json
    const packageJson = JSON.parse(tree.read('package.json').toString());
    // Verify dependencies are added
    expect(packageJson.dependencies).toMatchObject({
      constructs: expect.any(String),
      'aws-cdk-lib': expect.any(String),
      '@aws-cdk/aws-cognito-identitypool-alpha': expect.any(String),
      'oidc-client-ts': expect.any(String),
      'react-oidc-context': expect.any(String),
    });
  });
  it('should not be able to run the generator multiple times', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
        import { RuntimeConfigProvider } from './components/RuntimeConfig';
        import { BrowserRouter } from 'react-router-dom';

        export function App() {
          return (
            <RuntimeConfigProvider>
              <BrowserRouter>Hello World</BrowserRouter>
            </RuntimeConfigProvider>
          );
        }
      `
    );
    // First run to create files
    await cognitoAuthGenerator(tree, options);
    // Run generator again
    await expect(
      async () => await cognitoAuthGenerator(tree, options)
    ).rejects.toThrowErrorMatchingSnapshot();
  });
});
