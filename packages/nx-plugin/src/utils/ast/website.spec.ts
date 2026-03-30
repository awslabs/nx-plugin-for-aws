/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { addHookResultToRouterProviderContext } from './website';

describe('website ast utils', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  describe('addHookResultToRouterProviderContext', () => {
    const defaultProps = {
      hook: 'useAuth',
      module: 'react-oidc-context',
      contextProp: 'auth',
    };

    const baseMainTsxContent = `import { createRouter, RouterProvider } from '@tanstack/react-router';

type RouterProviderContext = {
  existingProp?: string;
};

const router = createRouter({
  context: {
    existingContext: undefined,
  },
});

const App = () => {
  return <RouterProvider router={router} context={{ existingContext: 'value' }} />;
};

export default App;`;

    it('should add hook import when all required elements exist', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('import { useAuth }');
      expect(updatedContent).toContain("from 'react-oidc-context'");
    });

    it('should update RouterProviderContext interface to include new context property', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('auth?: ReturnType<typeof useAuth>');
    });

    it('should preserve existing context properties in RouterProviderContext interface', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('existingProp?: string');
      expect(updatedContent).toContain('auth?: ReturnType<typeof useAuth>');
    });

    it('should not duplicate context property in RouterProviderContext interface if it already exists', async () => {
      const contentWithExistingAuth = baseMainTsxContent.replace(
        'type RouterProviderContext = {\n  existingProp?: string;\n};',
        'type RouterProviderContext = {\n  existingProp?: string;\n  auth?: ReturnType<typeof useAuth>;\n};',
      );

      tree.write('main.tsx', contentWithExistingAuth);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      const authMatches = (updatedContent.match(/auth\?:/g) || []).length;
      expect(authMatches).toBe(1);
    });

    it('should update router context to include new context property', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('auth: undefined');
    });

    it('should preserve existing context properties in router context object', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('existingContext: undefined');
      expect(updatedContent).toContain('auth: undefined');
    });

    it('should add hook call to App component when it has expression body', async () => {
      const expressionBodyContent = baseMainTsxContent.replace(
        "const App = () => {\n  return <RouterProvider router={router} context={{ existingContext: 'value' }} />;\n};",
        "const App = () => <RouterProvider router={router} context={{ existingContext: 'value' }} />;",
      );

      tree.write('main.tsx', expressionBodyContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('const auth = useAuth();');
    });

    it('should add hook call to App component when it has block body', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('const auth = useAuth();');
    });

    it('should not duplicate hook call if it already exists in App component', async () => {
      const contentWithExistingHook = baseMainTsxContent.replace(
        'const App = () => {',
        'const App = () => {\n  const auth = useAuth();',
      );

      tree.write('main.tsx', contentWithExistingHook);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      const hookCallMatches = (
        updatedContent.match(/const auth = useAuth\(\);/g) || []
      ).length;
      expect(hookCallMatches).toBe(1);
    });

    it('should update RouterProvider context prop to include new context property', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain(
        "context={{ existingContext: 'value', auth }}",
      );
    });

    it('should preserve existing context properties in RouterProvider context prop', async () => {
      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain("existingContext: 'value'");
      expect(updatedContent).toContain('auth');
    });

    it('should handle RouterProvider without existing context prop', async () => {
      const contentWithoutContext = baseMainTsxContent.replace(
        "<RouterProvider router={router} context={{ existingContext: 'value' }} />",
        '<RouterProvider router={router} />',
      );

      tree.write('main.tsx', contentWithoutContext);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('context={{ auth }}');
    });

    it('should not make changes if RouterProviderContext interface is missing', async () => {
      const contentWithoutInterface = baseMainTsxContent.replace(
        /type RouterProviderContext = \{[\s\S]*?\};/,
        '',
      );

      tree.write('main.tsx', contentWithoutInterface);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      // Should still add import but not make other changes
      expect(updatedContent).not.toContain('import { useAuth }');
      expect(updatedContent).not.toContain('auth?: ReturnType<typeof useAuth>');
    });

    it('should not make changes if createRouter call is missing', async () => {
      const contentWithoutRouter = baseMainTsxContent.replace(
        /const router = createRouter\(\{[\s\S]*?\}\);/,
        'const router = someOtherFunction();',
      );

      tree.write('main.tsx', contentWithoutRouter);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      // Should still add import but not make other changes
      expect(updatedContent).not.toContain('import { useAuth }');
      expect(updatedContent).not.toContain('auth?: ReturnType<typeof useAuth>');
    });

    it('should not make changes if App component is missing', async () => {
      const contentWithoutApp = baseMainTsxContent.replace(
        /const App = \(\) => \{[\s\S]*?\};/,
        'const SomeOtherComponent = () => {};',
      );

      tree.write('main.tsx', contentWithoutApp);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');

      expect(updatedContent).not.toContain('import { useAuth }');
      expect(updatedContent).not.toContain('auth?: ReturnType<typeof useAuth>');
    });

    it('should not make changes if RouterProvider component is missing', async () => {
      const contentWithoutRouterProvider = baseMainTsxContent.replace(
        "<RouterProvider router={router} context={{ existingContext: 'value' }} />",
        '<SomeOtherProvider />',
      );

      tree.write('main.tsx', contentWithoutRouterProvider);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');

      expect(updatedContent).not.toContain('import { useAuth }');
      expect(updatedContent).not.toContain('auth?: ReturnType<typeof useAuth>');
    });

    it('should handle different hook and context prop names', async () => {
      const customProps = {
        hook: 'useCustomHook',
        module: '@custom/package',
        contextProp: 'customContext',
      };

      tree.write('main.tsx', baseMainTsxContent);

      await addHookResultToRouterProviderContext(tree, 'main.tsx', customProps);

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('import { useCustomHook }');
      expect(updatedContent).toContain("from '@custom/package'");
      expect(updatedContent).toContain(
        'customContext?: ReturnType<typeof useCustomHook>',
      );
      expect(updatedContent).toContain(
        'const customContext = useCustomHook();',
      );
      expect(updatedContent).toContain('customContext: undefined');
      expect(updatedContent).toContain('customContext }');
    });

    it('should handle complex router context with multiple existing properties', async () => {
      const complexRouterContent = baseMainTsxContent.replace(
        `const router = createRouter({
  context: {
    existingContext: undefined,
  },
});`,
        `const router = createRouter({
  context: {
    existingContext: undefined,
    anotherContext: undefined,
    thirdContext: undefined,
  },
});`,
      );

      tree.write('main.tsx', complexRouterContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('existingContext: undefined');
      expect(updatedContent).toContain('anotherContext: undefined');
      expect(updatedContent).toContain('thirdContext: undefined');
      expect(updatedContent).toContain('auth: undefined');
    });

    it('should handle RouterProvider with complex existing context object', async () => {
      const complexContextContent = baseMainTsxContent.replace(
        `<RouterProvider router={router} context={{ existingContext: 'value' }} />`,
        `<RouterProvider router={router} context={{
          existingContext: 'value',
          anotherProp: someVariable,
          complexProp: { nested: true }
        }} />`,
      );

      tree.write('main.tsx', complexContextContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain("existingContext: 'value'");
      expect(updatedContent).toContain('anotherProp: someVariable');
      expect(updatedContent).toContain('complexProp: { nested: true }');
      expect(updatedContent).toContain('auth');
    });

    it('should handle App component with existing statements', async () => {
      const appWithStatementsContent = baseMainTsxContent.replace(
        `const App = () => {
  return <RouterProvider router={router} context={{ existingContext: 'value' }} />;
};`,
        `const App = () => {
  const someVariable = 'test';
  console.log('App is rendering');
  return <RouterProvider router={router} context={{ existingContext: 'value' }} />;
};`,
      );

      tree.write('main.tsx', appWithStatementsContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('const auth = useAuth();');
      expect(updatedContent).toContain("const someVariable = 'test';");
      expect(updatedContent).toContain("console.log('App is rendering');");

      // Ensure the hook call is added at the beginning
      const authIndex = updatedContent.indexOf('const auth = useAuth();');
      const someVariableIndex = updatedContent.indexOf(
        "const someVariable = 'test';",
      );
      expect(authIndex).toBeLessThan(someVariableIndex);
    });

    it('should handle RouterProviderContext with complex type definitions', async () => {
      const complexTypeContent = baseMainTsxContent.replace(
        `type RouterProviderContext = {
  existingProp?: string;
};`,
        `type RouterProviderContext = {
  existingProp?: string;
  complexProp?: {
    nested: boolean;
    array: string[];
  };
  unionProp?: string | number;
};`,
      );

      tree.write('main.tsx', complexTypeContent);

      await addHookResultToRouterProviderContext(
        tree,
        'main.tsx',
        defaultProps,
      );

      const updatedContent = tree.read('main.tsx', 'utf-8');
      expect(updatedContent).toContain('existingProp?: string');
      expect(updatedContent).toContain('complexProp?: {');
      expect(updatedContent).toContain('nested: boolean;');
      expect(updatedContent).toContain('array: string[];');
      expect(updatedContent).toContain('unionProp?: string | number;');
      expect(updatedContent).toContain('auth?: ReturnType<typeof useAuth>');
    });
  });
});
