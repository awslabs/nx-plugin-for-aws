/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { tsReactWebsiteAuthGenerator } from './generator';
import { TsReactWebsiteAuthGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { SUPPORTED_UX_PROVIDERS } from '../app/generator';

describe('cognito-auth generator uxProvider tests', () => {
  let tree: Tree;

  const options: TsReactWebsiteAuthGeneratorSchema = {
    project: 'test-project',
    cognitoDomain: 'test',
    allowSignup: true,
    iacProvider: 'CDK',
  };

  const setupTree = (uxProvider: string) => {
    tree = createTreeUsingTsSolutionSetup();

    // Set up a mock project structure
    tree.write(
      'packages/test-project/project.json',
      JSON.stringify({
        name: 'test-project',
        sourceRoot: 'packages/test-project/src',
        metadata: {
          uxProvider,
        },
      }),
    );

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
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it.each(SUPPORTED_UX_PROVIDERS.map((p) => [p]))(
    'should run generator without error for uxProvider=%s',
    async (uxProvider) => {
      setupTree(uxProvider);

      // If this test fails, you need to implement support for this ux provider in this generator!
      await tsReactWebsiteAuthGenerator(tree, options);
    },
  );

  describe('None', () => {
    beforeEach(() => {
      setupTree('None');
    });

    it('should update AppLayout', async () => {
      tree.write(
        'packages/test-project/src/components/AppLayout/index.tsx',
        `
        import { useAuth } from 'react-oidc-context';
import * as React from 'react';

import { useEffect, useMemo, useState } from 'react';

import Config from '../../config';
import { Link, useLocation, useMatchRoute } from '@tanstack/react-router';

const getBreadcrumbs = (
  matchRoute: ReturnType<typeof useMatchRoute>,
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
      !availableRoutes || availableRoutes.find((r) => matchRoute({ to: href }));

    return {
      href: matched ? \`\${href}\${search}\` : '#',
      text: segment,
    };
  });
};

/**
 * Defines the App layout and contains logic for routing.
 */
const AppLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, removeUser, signoutRedirect, clearStaleState } = useAuth();
  const [activeBreadcrumbs, setActiveBreadcrumbs] = useState<
    {
      href: string;
      text: string;
    }[]
  >([{ text: '/', href: '/' }]);
  const matchRoute = useMatchRoute();
  const { pathname, search } = useLocation();
  const navItems = useMemo(() => [{ to: '/', label: 'Home' }], []);
  useEffect(() => {
    const breadcrumbs = getBreadcrumbs(
      matchRoute,
      pathname,
      Object.entries(search).reduce((p, [k, v]) => p + \`\${k}=\${v}\`, ''),
      'Home',
    );
    setActiveBreadcrumbs(breadcrumbs);
  }, [matchRoute, pathname, search]);
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <a href="/">
              <img
                src={Config.logo}
                alt={\`\${Config.applicationName} logo\`}
                className="brand-logo"
              />
              <span className="brand-name">{Config.applicationName}</span>
            </a>
          </div>

          <nav className="app-nav">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={pathname === item.to ? 'active' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="user-greeting">
            <span>Hi, {\`\${user?.profile?.['cognito:username']}\`}</span>
            <button
              type="button"
              className="signout-link"
              onClick={() => {
                removeUser();
                signoutRedirect({
                  post_logout_redirect_uri: window.location.origin,
                  extraQueryParams: {
                    redirect_uri: window.location.origin,
                    response_type: 'code',
                  },
                });
                clearStaleState();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="app-main">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          {activeBreadcrumbs.map((crumb, index) => (
            <span className="breadcrumb-segment" key={crumb.href || index}>
              {index > 0 && <span className="breadcrumb-separator">/</span>}
              {index === activeBreadcrumbs.length - 1 ? (
                <span className="breadcrumb-current">{crumb.text}</span>
              ) : (
                <Link to={crumb.href}>{crumb.text}</Link>
              )}
            </span>
          ))}
        </nav>

        <section className="card">{children}</section>
      </main>
    </div>
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

      // Verify top navigation menu has user-greeting div
      expect(appLayoutContent).toContain('<div className="user-greeting">');

      expect(appLayoutContent).toContain(
        "Hi, {`${user?.profile?.['cognito:username']}`}",
      );

      // Verify sign out functionality
      expect(appLayoutContent).toContain('className="signout-link"');
      expect(appLayoutContent).toContain('Sign out');
      expect(appLayoutContent).toContain('removeUser()');
      expect(appLayoutContent).toContain('signoutRedirect(');
      expect(appLayoutContent).toContain('clearStaleState()');

      // Create snapshot of the modified AppLayout.tsx
      expect(appLayoutContent).toMatchSnapshot('app-layout-with-auth');
    });
  });

  describe('Cloudscape', () => {
    beforeEach(() => {
      setupTree('Cloudscape');
    });

    it('should update AppLayout', async () => {
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
  });

  describe('Shadcn', () => {
    beforeEach(() => {
      setupTree('Shadcn');
    });

    it('should update AppLayout', async () => {
      tree.write(
        'packages/test-project/src/components/AppLayout/index.tsx',
        `
        import * as React from "react";
        import { SidebarInset, SidebarProvider } from "common-shadcn/components/ui/sidebar";
        import { Separator } from "common-shadcn/components/ui/separator";
        import Config from "../../config";

        const AppLayout = ({ children }: { children: React.ReactNode }) => {
          return (
            <SidebarProvider>
              <SidebarInset>
                <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur">
                  <div className="flex items-center gap-3">
                    <Separator orientation="vertical" className="h-6" />
                    <div className="flex items-center gap-2">
                      <img
                        alt={\`\${Config.applicationName} logo\`}
                        className="size-10 rounded-lg border border-border/60 bg-background object-cover shadow-sm"
                        src={Config.logo}
                      />
                      <div className="flex flex-col leading-tight">
                        <span className="text-sm font-semibold">
                          {Config.applicationName}
                        </span>
                      </div>
                    </div>
                  </div>
                </header>
                <div className="flex flex-1 flex-col gap-6 p-6 pt-4">{children}</div>
              </SidebarInset>
            </SidebarProvider>
          );
        };

        export default AppLayout;
        `,
      );

      await tsReactWebsiteAuthGenerator(tree, options);

      const appLayoutContent = tree
        .read('packages/test-project/src/components/AppLayout/index.tsx')
        .toString();

      expect(appLayoutContent).toContain(
        'const { user, removeUser, signoutRedirect, clearStaleState } = useAuth()',
      );
      expect(appLayoutContent).toContain('Open user menu');
      expect(appLayoutContent).toContain('Sign out');
      expect(appLayoutContent).toContain('removeUser()');
      expect(appLayoutContent).toContain('signoutRedirect(');
      expect(appLayoutContent).toContain('clearStaleState()');
    });
  });
});
