/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateJson } from '@nx/devkit';
import {
  COGNITO_AUTH_GENERATOR_INFO,
  tsReactWebsiteAuthGenerator,
} from './generator';
import { TsReactWebsiteAuthGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { expectHasMetricTags } from '../../../utils/metrics.spec';

describe('cognito-auth generator', () => {
  let tree: Tree;

  const options: TsReactWebsiteAuthGeneratorSchema = {
    project: 'test-project',
    cognitoDomain: 'test',
    allowSignup: true,
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // Set up a mock project structure
    tree.write(
      'packages/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        sourceRoot: 'packages/test-project/src',
      }),
    );
  });

  it('should generate files', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export type RouterProviderContext = {}

      const router = createRouter({ routeTree });

      export function Main() {

      const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    await tsReactWebsiteAuthGenerator(tree, options);

    // Verify component files are generated
    expect(
      tree.exists('packages/test-project/src/components/CognitoAuth/index.tsx'),
    ).toBeTruthy();

    // Verify shared constructs files are generated
    expect(
      tree.exists('packages/common/constructs/src/core/user-identity.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/core/index.ts'),
    ).toBeTruthy();

    // Verify main.tsx imports are added
    const mainTsxContent = tree
      .read('packages/test-project/src/main.tsx')
      .toString();
    expect(mainTsxContent).toContain(
      "import CognitoAuth from './components/CognitoAuth'",
    );
    expect(mainTsxContent).toContain(
      "import { useRuntimeConfig } from './hooks/useRuntimeConfig'",
    );
    expect(mainTsxContent).toContain(
      "import { useAuth } from 'react-oidc-context'",
    );

    // Verify router context is updated
    expect(mainTsxContent).toContain('auth: undefined');
    expect(mainTsxContent).toContain('runtimeConfig: undefined');

    // Verify App component is updated
    expect(mainTsxContent).toContain('const auth = useAuth();');
    expect(mainTsxContent).toContain(
      'const runtimeConfig = useRuntimeConfig();',
    );
    expect(mainTsxContent).toContain(
      '<RouterProvider router={router} context={{ runtimeConfig, auth }} />',
    );

    // Create snapshot of the generated files
    expect(
      tree
        .read('packages/test-project/src/components/CognitoAuth/index.tsx')
        .toString(),
    ).toMatchSnapshot('cognito-auth-component');
    expect(
      tree.read('packages/common/constructs/src/core/index.ts').toString(),
    ).toMatchSnapshot('identity-index');
    expect(
      tree
        .read('packages/common/constructs/src/core/user-identity.ts')
        .toString(),
    ).toMatchSnapshot('user-identity');
  });

  it('should update main.tsx when RuntimeConfigProvider exists', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function Main() {

        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    await tsReactWebsiteAuthGenerator(tree, options);

    const mainTsxContent = tree
      .read('packages/test-project/src/main.tsx')
      .toString();
    // Verify CognitoAuth import is added
    expect(mainTsxContent).toContain(
      "import CognitoAuth from './components/CognitoAuth'",
    );

    // Verify CognitoAuth component is wrapped around children
    expect(mainTsxContent).toContain('<CognitoAuth>');
    expect(mainTsxContent).toContain('</CognitoAuth>');

    // Create snapshot of the modified main.tsx
    expect(mainTsxContent).toMatchSnapshot('main-tsx-with-runtime-config');
  });

  it('should update RouterProviderContext interface when it exists', async () => {
    // Setup main.tsx with RouterProviderContext interface and createRouter call
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';
      import { routeTree } from './routeTree.gen';

      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      export type RouterProviderContext = {};

      const router = createRouter({
        routeTree,
        context: {}
      });

      export function Main() {
        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    await tsReactWebsiteAuthGenerator(tree, options);

    const mainTsxContent = tree
      .read('packages/test-project/src/main.tsx')
      .toString();

    // Verify RouterProviderContext interface is updated with auth and runtimeConfig properties
    expect(mainTsxContent).toContain('auth?: ReturnType<typeof useAuth>');
    expect(mainTsxContent).toContain(
      'runtimeConfig?: ReturnType<typeof useRuntimeConfig>',
    );

    // Verify the interface is no longer empty
    expect(mainTsxContent).not.toContain(
      'export type RouterProviderContext = {};',
    );

    // Verify router context is updated with auth (and runtimeConfig from runtime-config generator)
    expect(mainTsxContent).toContain('auth: undefined');
    expect(mainTsxContent).toContain('runtimeConfig: undefined');

    // Verify App component uses hooks and passes context to RouterProvider
    expect(mainTsxContent).toContain('const auth = useAuth();');
    expect(mainTsxContent).toContain(
      'const runtimeConfig = useRuntimeConfig();',
    );
    expect(mainTsxContent).toContain(
      '<RouterProvider router={router} context={{ runtimeConfig, auth }} />',
    );
  });

  it('should update App component to use hooks and pass context to RouterProvider', async () => {
    // Setup main.tsx with App component and createRouter call
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';
      import { routeTree } from './routeTree.gen';

      export type RouterProviderContext = {};

      const router = createRouter({
        routeTree,
        context: {}
      });

      const App = () => {
        return <RouterProvider router={router} context={{}} />;
      };

      export function Main() {
        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    await tsReactWebsiteAuthGenerator(tree, options);

    const mainTsxContent = tree
      .read('packages/test-project/src/main.tsx')
      .toString();

    // Verify App component uses hooks
    expect(mainTsxContent).toContain('const auth = useAuth();');

    // Verify RouterProvider receives the context values (auth and runtimeConfig)
    expect(mainTsxContent).toContain(
      '<RouterProvider router={router} context={{ runtimeConfig, auth }} />',
    );
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
    `,
    );
    await expect(
      async () => await tsReactWebsiteAuthGenerator(tree, options),
    ).rejects.toThrowError();
  });

  it('should handle missing main.tsx', async () => {
    await expect(
      async () => await tsReactWebsiteAuthGenerator(tree, options),
    ).rejects.toThrowError();
  });

  it('should update shared constructs index.ts', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function Main() {

        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );
    // Setup initial shared constructs index
    tree.write(
      'packages/common/constructs/src/index.ts',
      'export const dummy = true;',
    );
    await tsReactWebsiteAuthGenerator(tree, options);
    const indexContent = tree
      .read('packages/common/constructs/src/core/index.ts')
      .toString();
    // Verify identity export is added
    expect(indexContent).toContain("export * from './user-identity.js'");
    // Create snapshot of the modified index
    expect(indexContent).toMatchSnapshot('common/constructs-index');
  });

  it('should add required dependencies', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function App() {
        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );
    await tsReactWebsiteAuthGenerator(tree, options);
    // Read package.json
    const packageJson = JSON.parse(tree.read('package.json').toString());
    // Verify dependencies are added
    expect(packageJson.dependencies).toMatchObject({
      constructs: expect.any(String),
      'aws-cdk-lib': expect.any(String),
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
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function App() {

        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );
    // First run to create files
    await tsReactWebsiteAuthGenerator(tree, options);
    // Run generator again
    await expect(
      async () => await tsReactWebsiteAuthGenerator(tree, options),
    ).rejects.toThrowErrorMatchingSnapshot();
  });

  it('should update AppLayout', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';


      export function App() {

        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    // Setup AppLayout.tsx with a basic component
    tree.write(
      'packages/test-project/src/components/AppLayout/index.tsx',
      `
      import * as React from 'react';
import { createContext, useCallback, useEffect, useState } from 'react';
import { NavItems } from './navitems';
import Config from '../../config';

import {
  BreadcrumbGroup,
  BreadcrumbGroupProps,
  SideNavigation,
  TopNavigation,
} from '@cloudscape-design/components';

import CloudscapeAppLayout, {
  AppLayoutProps,
} from '@cloudscape-design/components/app-layout';

import { matchByPath, useLocation, useNavigate } from '@tanstack/react-router';
import { Outlet } from '@tanstack/react-router';

const getBreadcrumbs = (
  pathName: string,
  search: string,
  defaultBreadcrumb: string,
  availableRoutes?: string[],
) => {
  const segments = [
    defaultBreadcrumb,
    ...pathName.split('/').filter((segment) => segment !== ''),
  ];

  return segments.map((segment, i) => {
    const href =
      i === 0
        ? '/'
        : \`/\${segments
            .slice(1, i + 1)
            .join('/')
            .replace('//', '/')}\`;

    const matched =
      !availableRoutes || availableRoutes.find((r) => matchByPath(r, href, {}));

    return {
      href: matched ? \`\${href}\${search}\` : '#',
      text: segment,
    };
  });
};

export interface AppLayoutContext {
  appLayoutProps: AppLayoutProps;
  setAppLayoutProps: (props: AppLayoutProps) => void;
  displayHelpPanel: (helpContent: React.ReactNode) => void;
}

/**
 * Context for updating/retrieving the AppLayout.
 */
export const AppLayoutContext = createContext({
  appLayoutProps: {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setAppLayoutProps: (_: AppLayoutProps) => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  displayHelpPanel: (_: React.ReactNode) => {},
});

/**
 * Defines the App layout and contains logic for routing.
 */
const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const appLayout = React.useRef<AppLayoutProps.Ref>(null);
  const [activeBreadcrumbs, setActiveBreadcrumbs] = useState<
    BreadcrumbGroupProps.Item[]
  >([{ text: '/', href: '/' }]);
  const [appLayoutProps, setAppLayoutProps] = useState<AppLayoutProps>({});
  const { pathname, search } = useLocation();

  const setAppLayoutPropsSafe = useCallback(
    (props: AppLayoutProps) => {
      JSON.stringify(appLayoutProps) !== JSON.stringify(props) &&
        setAppLayoutProps(props);
    },
    [appLayoutProps],
  );

  useEffect(() => {
    const breadcrumbs = getBreadcrumbs(
      pathname,
      Object.entries(search).reduce((p, [k, v]) => p + \`\${k}=\${v}\`, ''),
      '/',
    );
    setActiveBreadcrumbs(breadcrumbs);
  }, [pathname, search]);

  const onNavigate = useCallback(
    (e: CustomEvent<{ href: string; external?: boolean }>) => {
      if (!e.detail.external) {
        e.preventDefault();
        setAppLayoutPropsSafe({
          contentType: undefined,
        });
        navigate({ to: e.detail.href });
      }
    },
    [navigate, setAppLayoutPropsSafe],
  );

  return (
    <AppLayoutContext.Provider
      value={{
        appLayoutProps,
        setAppLayoutProps: setAppLayoutPropsSafe,
        displayHelpPanel: (helpContent: React.ReactNode) => {
          setAppLayoutPropsSafe({ tools: helpContent, toolsHide: false });
          appLayout.current?.openTools();
        },
      }}
    >
      <TopNavigation
        identity={{
          href: '/',
          title: Config.applicationName,
          logo: {
            src: Config.logo,
          },
        }}
      />
      <CloudscapeAppLayout
        ref={appLayout}
        breadcrumbs={
          <BreadcrumbGroup onFollow={onNavigate} items={activeBreadcrumbs} />
        }
        toolsHide
        navigation={
          <SideNavigation
            header={{ text: Config.applicationName, href: '/' }}
            activeHref={pathname}
            onFollow={onNavigate}
            items={NavItems}
          />
        }
        content={<Outlet />}
        {...appLayoutProps}
      />
    </AppLayoutContext.Provider>
  );
};

export default AppLayout;

    `,
    );

    await tsReactWebsiteAuthGenerator(tree, options);

    const appLayoutContent = tree
      .read('packages/test-project/src/components/AppLayout/index.tsx')
      .toString();

    // Verify useAuth import is added
    expect(appLayoutContent).toContain(
      "import { useAuth } from 'react-oidc-context'",
    );

    // Verify useAuth hook is used in the component
    expect(appLayoutContent).toContain(
      'const { user, removeUser, signoutRedirect, clearStaleState } = useAuth()',
    );

    // Verify TopNavigation has utilities attribute
    expect(appLayoutContent).toContain('utilities={[');
    expect(appLayoutContent).toContain("type: 'menu-dropdown'");
    expect(appLayoutContent).toContain(
      "text: `${user?.profile?.['cognito:username']}`",
    );
    expect(appLayoutContent).toContain("iconName: 'user-profile-active'");

    // Verify sign out functionality
    expect(appLayoutContent).toContain("id: 'signout'");
    expect(appLayoutContent).toContain("text: 'Sign out'");
    expect(appLayoutContent).toContain('removeUser()');
    expect(appLayoutContent).toContain('signoutRedirect(');
    expect(appLayoutContent).toContain('clearStaleState()');

    // Create snapshot of the modified AppLayout.tsx
    expect(appLayoutContent).toMatchSnapshot('app-layout-with-auth');
  });

  it('should allow an unqualified name to be specified', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function App() {

        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    // Use a fully-qualified name
    updateJson(tree, 'package.json', (packageJson) => ({
      ...packageJson,
      name: '@scope/source',
    }));
    tree.write(
      'packages/test-project/project.json',
      JSON.stringify({
        name: '@scope/test-project',
        sourceRoot: 'packages/test-project/src',
      }),
    );

    await tsReactWebsiteAuthGenerator(tree, {
      ...options,
      project: 'test-project', // unqualified
    });
  });

  it('should throw when cognito domain is empty', async () => {
    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function App() {

        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    await expect(() =>
      tsReactWebsiteAuthGenerator(tree, {
        ...options,
        cognitoDomain: '',
      }),
    ).rejects.toThrow(/A Cognito domain must be specified/);
  });

  it('should not duplicate comments in IRuntimeConfig', async () => {
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function App() {

        const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    await sharedConstructsGenerator(tree);

    tree.write(
      'packages/common/types/src/runtime-config.ts',
      `
// Some comment
export interface IRuntimeConfig {}
      `,
    );

    await tsReactWebsiteAuthGenerator(tree, {
      ...options,
    });

    const runtimeConfigContent = tree.read(
      'packages/common/types/src/runtime-config.ts',
      'utf-8',
    );
    expect(runtimeConfigContent).toContain(`
// Some comment
export interface IRuntimeConfig`);

    expect(runtimeConfigContent.indexOf('Some comment')).toEqual(
      runtimeConfigContent.lastIndexOf('Some comment'),
    );
  });

  it('should add generator metric to app.ts', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree);

    // Setup main.tsx with RuntimeConfigProvider
    tree.write(
      'packages/test-project/src/main.tsx',
      `
      import { RuntimeConfigProvider } from './components/RuntimeConfig';
      import { RouterProvider, createRouter } from '@tanstack/react-router';

      export function App() {

      const App = () => <RouterProvider router={router} />;

        return (
          <RuntimeConfigProvider>
            <App/>
          </RuntimeConfigProvider>
        );
      }
    `,
    );

    // Call the generator function
    await tsReactWebsiteAuthGenerator(tree, options);

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, COGNITO_AUTH_GENERATOR_INFO.metric);
  });
});
