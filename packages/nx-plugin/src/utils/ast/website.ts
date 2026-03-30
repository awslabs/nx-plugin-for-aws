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

  // 1. Add property to RouterProviderContext type (handles both empty and non-empty, exported and non-exported)
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or { \`type RouterProviderContext = {}\` => \`type RouterProviderContext = { ${contextProp}?: ReturnType<typeof ${hook}> }\`, \`type RouterProviderContext = { $props }\` => \`type RouterProviderContext = { $props; ${contextProp}?: ReturnType<typeof ${hook}> }\` where { $props <: not contains \`${contextProp}\` } }`,
  );

  // 2. Add context property to createRouter config
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`createRouter({ $props })\` => \`createRouter({ $props, context: { ${contextProp}: undefined } })\` where { $props <: not contains \`context\` }`,
  );
  // If context already exists, add the new prop to it
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`context: { $cprops }\` where { $cprops <: within \`createRouter($_)\`, $cprops <: not contains \`${contextProp}\`, $cprops += \`, ${contextProp}: undefined\` }`,
  );

  // 3. Add hook call to App component body
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or { \`const App = () => { $body }\` => raw\`const App = () => {
  const ${contextProp} = ${hook}();
  $body
}\` where { $program <: not contains \`${hook}()\` }, \`const App = () => $expr\` => raw\`const App = () => {
  const ${contextProp} = ${hook}();
  return $expr;
}\` where { $program <: not contains \`${hook}()\` } }`,
  );

  // 4. Add context prop to RouterProvider JSX element
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`<RouterProvider $attrs context={{ $cprops }} />\` => \`<RouterProvider $attrs context={{ $cprops, ${contextProp} }} />\` where { $cprops <: not contains \`${contextProp}\` }`,
  );
  // If no context attribute exists, add it
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`<RouterProvider $attrs />\` => \`<RouterProvider $attrs context={{ ${contextProp} }} />\` where { $attrs <: not contains \`context\` }`,
  );
};
