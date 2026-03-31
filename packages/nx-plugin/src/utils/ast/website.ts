/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDestructuredImport,
  applyGritQLTransform,
  applyGritQLAppend,
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
  //    Type members: += with leading newline handles separation (existing members end with ;)
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or {
      \`type RouterProviderContext = {}\` => \`type RouterProviderContext = {
  ${contextProp}?: ReturnType<typeof ${hook}>;
}\`,
      \`type RouterProviderContext = { $members }\` where {
        $members <: not contains \`${contextProp}\`,
        $members += \`
${contextProp}?: ReturnType<typeof ${hook}>\`
      }
    }`,
  );

  // 2. Add context property to createRouter config
  await applyGritQLAppend(
    tree,
    mainTsxPath,
    `\`createRouter({ $props })\` where { $props <: not contains \`context\`, $props += \`context: { ${contextProp}: undefined }\` }`,
    `\`createRouter({ $props })\` => \`createRouter({ $props, context: { ${contextProp}: undefined } })\` where { $props <: not contains \`context\` }`,
    `\`context: { ${contextProp}: undefined }\``,
  );
  // If context already exists, add the new prop to it
  // Handle empty context: {} separately (GritQL can't += on empty objects)
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `\`context: {}\` => \`context: { ${contextProp}: undefined }\``,
  );
  // Handle non-empty context via += with fallback
  await applyGritQLAppend(
    tree,
    mainTsxPath,
    `\`context: { $cprops }\` where { $cprops <: within \`createRouter($_)\`, $cprops <: not contains \`${contextProp}\`, $cprops += \`${contextProp}: undefined\` }`,
    `\`context: { $cprops }\` => \`context: { $cprops, ${contextProp}: undefined }\` where { $cprops <: within \`createRouter($_)\`, $cprops <: not contains \`${contextProp}\` }`,
    `\`${contextProp}: undefined\``,
  );

  // 3. Add hook call to App component body
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or {
      \`const App = () => { $body }\` => raw\`const App = () => {
  const ${contextProp} = ${hook}();
  $body
}\` where { $program <: not contains \`${hook}()\` },
      \`const App = () => $expr\` => raw\`const App = () => {
  const ${contextProp} = ${hook}();
  return $expr;
}\` where { $program <: not contains \`${hook}()\` }
    }`,
  );

  // 4. Add context prop to RouterProvider JSX element
  await applyGritQLTransform(
    tree,
    mainTsxPath,
    `or {
      \`<RouterProvider $attrs context={{}} />\` => \`<RouterProvider $attrs context={{ ${contextProp} }} />\`,
      \`<RouterProvider $attrs context={{ $cprops }} />\` => \`<RouterProvider $attrs context={{ $cprops, ${contextProp} }} />\` where {
        $cprops <: not contains \`${contextProp}\`
      },
      \`<RouterProvider $attrs />\` => \`<RouterProvider $attrs context={{ ${contextProp} }} />\` where {
        $attrs <: not contains \`context\`
      }
    }`,
  );
};
