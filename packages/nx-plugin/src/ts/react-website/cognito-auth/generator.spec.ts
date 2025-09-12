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
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../../utils/config/utils';

describe('cognito-auth generator', () => {
  let tree: Tree;

  const options: TsReactWebsiteAuthGeneratorSchema = {
    project: 'test-project',
    cognitoDomain: 'test',
    allowSignup: true,
    iacProvider: 'CDK',
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

  it('should add generator metric to app.ts', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

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

  describe('terraform iacProvider', () => {
    beforeEach(() => {
      // Setup main.tsx with RuntimeConfigProvider for terraform tests
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
    });

    it('should generate terraform files for cognito auth and snapshot them', async () => {
      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreUserIdentityFile = terraformFiles.find(
        (f) => f.includes('user-identity') && f.includes('main.tf'),
      );
      const identityFile = terraformFiles.find((f) =>
        f.includes('identity.tf'),
      );
      const addCallbackUrlFile = terraformFiles.find((f) =>
        f.includes('add-callback-url'),
      );

      expect(coreUserIdentityFile).toBeDefined();
      expect(identityFile).toBeDefined();
      expect(addCallbackUrlFile).toBeDefined();

      // Read terraform file contents
      const coreUserIdentityContent = tree.read(coreUserIdentityFile!, 'utf-8');
      const identityContent = tree.read(identityFile!, 'utf-8');
      const addCallbackUrlContent = tree.read(addCallbackUrlFile!, 'utf-8');

      // Verify user identity configuration (resources are in identity.tf)
      expect(identityContent).toContain('resource "aws_cognito_user_pool"');
      expect(identityContent).toContain(
        'resource "aws_cognito_user_pool_client"',
      );
      expect(identityContent).toContain(
        'resource "aws_cognito_user_pool_domain"',
      );

      // Verify add callback URL configuration
      expect(addCallbackUrlContent).toContain('variable "callback_url"');
      expect(addCallbackUrlContent).toContain('local.user_pool_client_id');
      expect(addCallbackUrlContent).toContain('null_resource');

      // Snapshot terraform files
      const terraformFileContents = {
        'user-identity.tf': coreUserIdentityContent,
        'add-callback-url.tf': addCallbackUrlContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-cognito-auth-files',
      );
    });

    it('should update static-website.tf with add-callback-url module', async () => {
      // First create a core static website terraform file with CloudFront distribution
      tree.write(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        `
resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id   = "S3-\${aws_s3_bucket.website.id}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-\${aws_s3_bucket.website.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
        `,
      );

      // Create a project-specific static website terraform file
      tree.write(
        'packages/common/terraform/src/app/static-websites/test-project/test-project.tf',
        `
module "static_website" {
  source = "../../../core/static-website"

  website_name = "test-project"
  build_path   = "dist/packages/test-project"
}
        `,
      );

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      // Verify core static website terraform file exists and has add-callback-url module
      const coreStaticWebsiteFile =
        'packages/common/terraform/src/core/static-website/static-website.tf';
      expect(tree.exists(coreStaticWebsiteFile)).toBeTruthy();

      const coreStaticWebsiteContent = tree.read(
        coreStaticWebsiteFile,
        'utf-8',
      );

      // Verify add-callback-url module is added to core static-website.tf
      expect(coreStaticWebsiteContent).toContain('module "add_callback_url"');
      expect(coreStaticWebsiteContent).toContain(
        'source = "../user-identity/add-callback-url"',
      );
      expect(coreStaticWebsiteContent).toContain(
        'callback_url = "https://${aws_cloudfront_distribution.website.domain_name}"',
      );

      // Read the project-specific static website terraform file
      const staticWebsiteContent = tree.read(
        'packages/common/terraform/src/app/static-websites/test-project/test-project.tf',
        'utf-8',
      );

      // Verify the original static website module is still present in project file
      expect(staticWebsiteContent).toContain('module "static_website"');
      expect(staticWebsiteContent).toContain('website_name = "test-project"');

      // Create snapshot of the updated static website terraform file
      expect(staticWebsiteContent).toMatchSnapshot(
        'static-website-with-callback-url',
      );
    });

    it('should not duplicate add-callback-url module if already present', async () => {
      // First create a core static website terraform file with add-callback-url already present
      tree.write(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        `
resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id   = "S3-\${aws_s3_bucket.website.id}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-\${aws_s3_bucket.website.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Add CloudFront domain to user pool client callback URLs
module "add_callback_url" {
  source = "../user-identity/add-callback-url"

  callback_url = "https://\${aws_cloudfront_distribution.website.domain_name}"

  depends_on = [aws_cloudfront_distribution.website]
}
        `,
      );

      // Create a project-specific static website terraform file
      tree.write(
        'packages/common/terraform/src/app/static-websites/test-project/test-project.tf',
        `
module "static_website" {
  source = "../../../core/static-website"

  website_name = "test-project"
  build_path   = "dist/packages/test-project"
}
        `,
      );

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      // Read the core static website terraform file
      const coreStaticWebsiteContent = tree.read(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        'utf-8',
      );

      // Count occurrences of add_callback_url module in core file
      const addCallbackUrlMatches = coreStaticWebsiteContent.match(
        /module "add_callback_url"/g,
      );
      expect(addCallbackUrlMatches).toHaveLength(1);

      // Verify the module is still present and correctly configured
      expect(coreStaticWebsiteContent).toContain('module "add_callback_url"');
      expect(coreStaticWebsiteContent).toContain(
        'source = "../user-identity/add-callback-url"',
      );
    });

    it('should configure project targets and dependencies correctly for terraform', async () => {
      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      // Check that shared terraform project exists and has build target
      const sharedTerraformConfig = JSON.parse(
        tree.read('packages/common/terraform/project.json', 'utf-8'),
      );

      // Verify the terraform project has a build target (dependencies are managed by website generator)
      expect(sharedTerraformConfig.targets.build).toBeDefined();

      // Verify project configuration exists
      const projectConfig = JSON.parse(
        tree.read('packages/test-project/project.json', 'utf-8'),
      );

      // Project should exist (metadata is managed by the website generator, not auth generator)
      expect(projectConfig.name).toBe('test-project');
    });

    it('should not create CDK constructs when using terraform', async () => {
      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      // Verify CDK files are NOT created
      expect(
        tree.exists('packages/common/constructs/src/core/user-identity.ts'),
      ).toBeFalsy();
    });

    it('should throw error for invalid iacProvider', async () => {
      await expect(
        tsReactWebsiteAuthGenerator(tree, {
          ...options,
          iacProvider: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iacProvider InvalidProvider');
    });

    it('should handle terraform with different project structures', async () => {
      // First create a core static website terraform file with CloudFront distribution
      tree.write(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        `
resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id   = "S3-\${aws_s3_bucket.website.id}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-\${aws_s3_bucket.website.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
        `,
      );

      // Setup a project in a different location
      tree.write(
        'apps/nested/test-website/project.json',
        JSON.stringify({
          name: 'nested-test-website',
          sourceRoot: 'apps/nested/test-website/src',
        }),
      );

      tree.write(
        'apps/nested/test-website/src/main.tsx',
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

      // Create a static website terraform file for the nested project
      tree.write(
        'packages/common/terraform/src/app/static-websites/nested-test-website/nested-test-website.tf',
        `
module "static_website" {
  source = "../../../core/static-website"

  website_name = "nested-test-website"
  build_path   = "dist/apps/nested/test-website"
}
        `,
      );

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        project: 'nested-test-website',
        iacProvider: 'Terraform',
      });

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Verify core static website file has the add-callback-url module
      const coreStaticWebsiteFile =
        'packages/common/terraform/src/core/static-website/static-website.tf';
      expect(tree.exists(coreStaticWebsiteFile)).toBeTruthy();

      const coreStaticWebsiteContent = tree.read(
        coreStaticWebsiteFile,
        'utf-8',
      );
      expect(coreStaticWebsiteContent).toContain('module "add_callback_url"');

      // Verify the nested project's static website file exists and has correct name
      const staticWebsiteContent = tree.read(
        'packages/common/terraform/src/app/static-websites/nested-test-website/nested-test-website.tf',
        'utf-8',
      );

      expect(staticWebsiteContent).toContain(
        'website_name = "nested-test-website"',
      );
    });

    it('should handle allowSignup option correctly in terraform', async () => {
      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        allowSignup: false,
        iacProvider: 'Terraform',
      });

      // Find the core user identity terraform file
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );
      const identityFile = terraformFiles.find((f) =>
        f.includes('identity.tf'),
      );
      expect(identityFile).toBeDefined();

      const terraformContent = tree.read(identityFile!, 'utf-8');

      // Verify signup configuration is handled correctly
      expect(terraformContent).toContain('resource "aws_cognito_user_pool"');
      // The allowSignup option should affect the user pool configuration
      expect(terraformContent).toContain('admin_create_user_config');
    });

    it('should handle cognitoDomain option correctly in terraform', async () => {
      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        cognitoDomain: 'custom-domain',
        iacProvider: 'Terraform',
      });

      // Find the core user identity terraform file
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );
      const identityFile = terraformFiles.find((f) =>
        f.includes('identity.tf'),
      );
      expect(identityFile).toBeDefined();

      const terraformContent = tree.read(identityFile!, 'utf-8');

      // Verify domain configuration
      expect(terraformContent).toContain(
        'resource "aws_cognito_user_pool_domain"',
      );
      expect(terraformContent).toContain('var.user_pool_domain_prefix');
    });

    it('should place add-callback-url module directly after cloudfront distribution resource', async () => {
      // Create a complex static website terraform file with multiple resources after CloudFront
      tree.write(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        `
# Some initial resources
resource "aws_s3_bucket" "website" {
  bucket = "test-bucket"
}

resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id   = "S3-\${aws_s3_bucket.website.id}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-\${aws_s3_bucket.website.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# S3 Bucket Policy for CloudFront OAC
resource "aws_s3_bucket_policy" "website_cloudfront_policy" {
  bucket = aws_s3_bucket.website.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "\${aws_s3_bucket.website.arn}/*"
      }
    ]
  })
}

# Some outputs
output "website_bucket_name" {
  value = aws_s3_bucket.website.bucket
}
        `,
      );

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      const coreStaticWebsiteContent = tree.read(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        'utf-8',
      );

      // Verify add-callback-url module is added
      expect(coreStaticWebsiteContent).toContain('module "add_callback_url"');

      // With the new brace-counting implementation, the module should be placed
      // directly after the CloudFront distribution resource and before the next resource
      const cloudfrontEndIndex = coreStaticWebsiteContent.indexOf(
        '  viewer_certificate {\n    cloudfront_default_certificate = true\n  }\n}',
      );
      const addCallbackModuleIndex = coreStaticWebsiteContent.indexOf(
        'module "add_callback_url"',
      );
      const nextResourceIndex = coreStaticWebsiteContent.indexOf(
        '# S3 Bucket Policy for CloudFront OAC',
      );

      expect(cloudfrontEndIndex).toBeGreaterThan(-1);
      expect(addCallbackModuleIndex).toBeGreaterThan(cloudfrontEndIndex);
      expect(nextResourceIndex).toBeGreaterThan(addCallbackModuleIndex);

      // Verify the module placement is correct
      expect(coreStaticWebsiteContent).toMatchSnapshot(
        'complex-static-website-with-callback-url',
      );
    });

    it('should handle cloudfront distribution with lifecycle blocks and complex configuration', async () => {
      // Create a static website terraform file with complex CloudFront configuration
      tree.write(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        `
resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id   = "S3-\${aws_s3_bucket.website.id}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-\${aws_s3_bucket.website.id}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  lifecycle {
    replace_triggered_by = [
      aws_wafv2_web_acl.cloudfront_waf
    ]
  }
}

resource "aws_s3_bucket_policy" "next_resource" {
  bucket = "test"
}
        `,
      );

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      const coreStaticWebsiteContent = tree.read(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        'utf-8',
      );

      // Verify add-callback-url module is added after the lifecycle block
      expect(coreStaticWebsiteContent).toContain('module "add_callback_url"');

      // With the new brace-counting implementation, verify the module is placed
      // directly after the entire CloudFront resource (including lifecycle)
      const lifecycleEndIndex = coreStaticWebsiteContent.indexOf('  ]\n  }\n}');
      const addCallbackModuleIndex = coreStaticWebsiteContent.indexOf(
        'module "add_callback_url"',
      );
      const nextResourceIndex = coreStaticWebsiteContent.indexOf(
        'resource "aws_s3_bucket_policy" "next_resource"',
      );

      expect(lifecycleEndIndex).toBeGreaterThan(-1);
      expect(addCallbackModuleIndex).toBeGreaterThan(lifecycleEndIndex);
      expect(nextResourceIndex).toBeGreaterThan(addCallbackModuleIndex);
    });

    it('should handle cloudfront distribution at end of file', async () => {
      // Create a static website terraform file with CloudFront at the end
      tree.write(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        `
resource "aws_s3_bucket" "website" {
  bucket = "test-bucket"
}

resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id   = "S3-\${aws_s3_bucket.website.id}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-\${aws_s3_bucket.website.id}"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}`,
      );

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      const coreStaticWebsiteContent = tree.read(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        'utf-8',
      );

      // Verify add-callback-url module is added at the end
      expect(coreStaticWebsiteContent).toContain('module "add_callback_url"');
      expect(
        coreStaticWebsiteContent.endsWith(
          '  depends_on = [aws_cloudfront_distribution.website]\n}',
        ),
      ).toBeTruthy();
    });

    it('should handle cloudfront distribution with comments and complex formatting', async () => {
      // Create a static website terraform file with comments and complex formatting
      tree.write(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        `
# CloudFront Distribution
resource "aws_cloudfront_distribution" "website" {
  #checkov:skip=CKV_AWS_174:Using CloudFront default certificate
  #checkov:skip=CKV_AWS_310:Origin failover not required
  origin {
    domain_name              = aws_s3_bucket.website.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.website_oac.id
    origin_id                = "S3-\${aws_s3_bucket.website.bucket}"
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  web_acl_id          = aws_wafv2_web_acl.cloudfront_waf.arn

  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.distribution_logs.bucket_regional_domain_name
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-\${aws_s3_bucket.website.bucket}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  # Custom error responses for SPA routing
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "test-distribution"
  }

  lifecycle {
    replace_triggered_by = [
      aws_wafv2_web_acl.cloudfront_waf
    ]
  }
}

# Next resource after CloudFront
resource "aws_s3_bucket_policy" "website_cloudfront_policy" {
  bucket = aws_s3_bucket.website.id
}
        `,
      );

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Terraform',
      });

      const coreStaticWebsiteContent = tree.read(
        'packages/common/terraform/src/core/static-website/static-website.tf',
        'utf-8',
      );

      // Verify add-callback-url module is added
      expect(coreStaticWebsiteContent).toContain('module "add_callback_url"');

      // With the new brace-counting implementation, verify the module is placed
      // directly after the CloudFront resource and before the next resource
      const cloudfrontEndIndex =
        coreStaticWebsiteContent.indexOf('  ]\n  }\n}');
      const addCallbackModuleIndex = coreStaticWebsiteContent.indexOf(
        'module "add_callback_url"',
      );
      const nextResourceIndex = coreStaticWebsiteContent.indexOf(
        '# Next resource after CloudFront',
      );

      expect(cloudfrontEndIndex).toBeGreaterThan(-1);
      expect(addCallbackModuleIndex).toBeGreaterThan(cloudfrontEndIndex);
      expect(nextResourceIndex).toBeGreaterThan(addCallbackModuleIndex);
    });

    it('should inherit iacProvider from config when set to Inherit', async () => {
      // Set up config with Terraform provider using utility methods
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'Terraform',
        },
      });

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

      await tsReactWebsiteAuthGenerator(tree, {
        ...options,
        iacProvider: 'Inherit',
      });

      // Verify Terraform files are created (not CDK constructs)
      expect(tree.exists('packages/common/terraform')).toBeTruthy();
      expect(tree.exists('packages/common/constructs')).toBeFalsy();

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );
      expect(terraformFiles.length).toBeGreaterThan(0);
    });
  });
});
