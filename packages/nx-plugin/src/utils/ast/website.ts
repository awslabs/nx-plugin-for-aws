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
  const content = tree.read(mainTsxPath, 'utf-8')!;
  const typeMatch = content.match(
    /type RouterProviderContext\s*=\s*\{([^}]*)\}/,
  );
  if (typeMatch && !typeMatch[1].includes(`${contextProp}?:`)) {
    const existingBody = typeMatch[1].trim();
    const newProp = `${contextProp}?: ReturnType<typeof ${hook}>`;
    const newBody = existingBody
      ? `${existingBody}\n  ${newProp};`
      : `\n  ${newProp};\n`;
    tree.write(
      mainTsxPath,
      content.replace(typeMatch[0], `type RouterProviderContext = {${newBody}}`),
    );
  }

  // 2. Add context property to createRouter config
  {
    const src = tree.read(mainTsxPath, 'utf-8')!;
    const createRouterIdx = src.indexOf('createRouter(');
    if (createRouterIdx !== -1) {
      // Extract content between createRouter({ and })
      const openBrace = src.indexOf('{', createRouterIdx);
      // Find matching close: track brace depth
      let depth = 1;
      let i = openBrace + 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      }
      const closeBrace = i - 1;
      const routerBody = src.slice(openBrace + 1, closeBrace);

      if (!routerBody.includes('context')) {
        // Add context property before closing brace, ensuring comma after previous property
        const beforeClose = src.slice(0, closeBrace).trimEnd();
        const needsComma =
          beforeClose.length > 0 &&
          !beforeClose.endsWith(',') &&
          !beforeClose.endsWith('{');
        tree.write(
          mainTsxPath,
          beforeClose +
            (needsComma ? ',' : '') +
            `\n  context: { ${contextProp}: undefined },\n` +
            src.slice(closeBrace),
        );
      } else if (!routerBody.includes(contextProp)) {
        // Add prop to existing context object within createRouter
        const contextIdx = src.indexOf('context:', createRouterIdx);
        if (contextIdx !== -1) {
          const ctxOpenBrace = src.indexOf('{', contextIdx);
          let ctxDepth = 1;
          let j = ctxOpenBrace + 1;
          while (j < src.length && ctxDepth > 0) {
            if (src[j] === '{') ctxDepth++;
            else if (src[j] === '}') ctxDepth--;
            j++;
          }
          const ctxCloseBrace = j - 1;
          const beforeCtxClose = src.slice(0, ctxCloseBrace).trimEnd();
          const needsCtxComma =
            beforeCtxClose.length > 0 &&
            !beforeCtxClose.endsWith(',') &&
            !beforeCtxClose.endsWith('{');
          tree.write(
            mainTsxPath,
            beforeCtxClose +
              (needsCtxComma ? ',' : '') +
              ` ${contextProp}: undefined,\n    ` +
              src.slice(ctxCloseBrace),
          );
        }
      }
    }
  }

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
  {
    const src = tree.read(mainTsxPath, 'utf-8')!;
    const rpMatch = src.match(/<RouterProvider([^/]*)\s*\/>/);
    if (rpMatch && !rpMatch[1].includes(contextProp)) {
      const attrs = rpMatch[1];
      const contextAttrMatch = attrs.match(/context=\{\{([^}]*)\}\}/);
      if (contextAttrMatch) {
        // Existing context attribute — add prop
        const existingProps = contextAttrMatch[1].trim();
        const newProps = existingProps
          ? `${existingProps}, ${contextProp}`
          : contextProp;
        tree.write(
          mainTsxPath,
          src.replace(
            contextAttrMatch[0],
            `context={{ ${newProps} }}`,
          ),
        );
      } else {
        // No context attribute — add it
        tree.write(
          mainTsxPath,
          src.replace(
            rpMatch[0],
            `<RouterProvider${attrs} context={{ ${contextProp} }} />`,
          ),
        );
      }
    }
  }
};
