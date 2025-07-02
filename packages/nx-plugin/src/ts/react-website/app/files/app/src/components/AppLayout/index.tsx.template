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
        : `/${segments
            .slice(1, i + 1)
            .join('/')
            .replace('//', '/')}`;

    const matched =
      !availableRoutes || availableRoutes.find((r) => matchByPath(r, href, {}));

    return {
      href: matched ? `${href}${search}` : '#',
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
      Object.entries(search).reduce((p, [k, v]) => p + `${k}=${v}`, ''),
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
