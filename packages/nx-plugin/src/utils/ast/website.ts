/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDestructuredImport,
  applyGritQLTransform,
  hasGritQLMatch,
} from '../ast';
import { Tree } from '@nx/devkit';

export interface AddHookResultToRouterProviderContextProps {
  hook: string; // eg useAuth
  module: string; // eg. react-oidc-context
  contextProp: string; // eg. auth
}

export const addHookResultToRouterProviderContext = async (
  tree: Tree,
  mainTsxPath: string,
  { hook, module, contextProp }: AddHookResultToRouterProviderContextProps,
) => {
  // All 4 patterns must exist for this transform to apply
  const checks = await Promise.all([
    hasGritQLMatch(tree, mainTsxPath, '`RouterProviderContext`'),
    hasGritQLMatch(tree, mainTsxPath, '`createRouter($_)`'),
    hasGritQLMatch(tree, mainTsxPath, '`const App = $_`'),
    hasGritQLMatch(tree, mainTsxPath, '`<RouterProvider $_ />`'),
  ]);

  if (checks.some((c) => !c)) {
    return;
  }

  await addDestructuredImport(tree, mainTsxPath, [hook], module);

  // 1. Add property to RouterProviderContext type
  //    'some' checks direct members only (not nested), so a nested 'auth' won't block adding a top-level one.
  //    Type members use ; as terminators, so += with leading \n handles separation.
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or {
      \`type RouterProviderContext = {}\` => \`type RouterProviderContext = {
  ${contextProp}?: ReturnType<typeof ${hook}>;
}\`,
      \`type RouterProviderContext = { $members }\` where {
        $members <: not some \`${contextProp}?: $_\`,
        $members += \`
${contextProp}?: ReturnType<typeof ${hook}>\`
      }
    }`,
  );

  // 2. Add context property to createRouter config
  //    'some' checks direct properties of the createRouter argument object only.
  //    Use += for multi-prop objects, => rewrite for single-prop.
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`createRouter({ $props })\` where {
      $props <: not some \`context: $_\`,
      $props += \`context: { ${contextProp}: undefined }\`
    }`,
  );

  // If context already exists, add the new prop to it.
  // Handle empty context: {} via nested contains => rewrite, scoped to createRouter.
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`createRouter({ $props })\` where {
      $props <: contains \`context: {}\` => \`context: { ${contextProp}: undefined }\`
    }`,
  );
  // Handle non-empty context via rewrite (the context object may be single-prop
  // from the first hook call, where += concatenates without comma)
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`context: { $cprops }\` => \`context: { $cprops, ${contextProp}: undefined }\` where {
      $cprops <: within \`createRouter($_)\`,
      $cprops <: not some \`${contextProp}: $_\`
    }`,
  );

  // 3. Add hook call to App component body
  //    Block body: 'some' checks direct statements.
  //    Expression body: 'contains' to also prevent matching block bodies.
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or {
      \`const App = () => { $body }\` => raw\`const App = () => {
  const ${contextProp} = ${hook}();
  $body
}\` where { $body <: not some \`const ${contextProp} = ${hook}()\` },
      \`const App = () => $expr\` => raw\`const App = () => {
  const ${contextProp} = ${hook}();
  return $expr;
}\` where { $expr <: not contains \`${hook}()\` }
    }`,
  );

  // 4. Add context prop to RouterProvider JSX element
  //    'some' checks direct JSX attributes only.
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or {
      \`<RouterProvider $attrs context={{}} />\` => \`<RouterProvider $attrs context={{ ${contextProp} }} />\`,
      \`<RouterProvider $attrs context={{ $cprops }} />\` => \`<RouterProvider $attrs context={{ $cprops, ${contextProp} }} />\` where {
        $cprops <: not some \`${contextProp}\`
      },
      \`<RouterProvider $attrs />\` => \`<RouterProvider $attrs context={{ ${contextProp} }} />\` where {
        $attrs <: not some \`context\`
      }
    }`,
  );
};
