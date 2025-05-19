/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensure that all imports from @modelcontextprotocol end with .js',
    },
    fixable: 'code',
    schema: [], // no options
    messages: {
      requireJsExtension:
        'Imports from @modelcontextprotocol must end with .js extension',
    },
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        // Check if this is an import from @modelcontextprotocol
        const source = node.source.value;
        if (
          typeof source === 'string' &&
          source.startsWith('@modelcontextprotocol/')
        ) {
          // Check if the import already ends with .js
          if (!source.endsWith('.js')) {
            context.report({
              node,
              messageId: 'requireJsExtension',
              fix(fixer) {
                // Add .js extension to the import
                const newSource = `${source}.js`;
                return fixer.replaceText(node.source, `'${newSource}'`);
              },
            });
          }
        }
      },
    };
  },
};
