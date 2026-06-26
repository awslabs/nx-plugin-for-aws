/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import camelCase from 'lodash.camelcase';
import deburr from 'lodash.deburr';

export const toClassName = (str?: string): string => {
  if (!str) {
    return str;
  }
  const words = str.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/);
  return words
    .map((word, index) => {
      if (index === 0 && /^\d/.test(word)) {
        return '_' + word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('');
};

export const toKebabCase = (str?: string): string =>
  str?.split('/').map(kebabCase).join('/');

export const toSnakeCase = (str?: string): string =>
  str?.split('/').map(snakeCase).join('/');

export const upperFirst = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1);

export const pascalCase = (str: string): string => upperFirst(camelCase(str));

export const snakeCase = (str: string): string => {
  return (
    deburr(str)
      // Replace series of special characters with underscores
      .replace(/[^a-zA-Z0-9]+/g, '_')
      // Replace capital letters preceded by lowercase or numbers with underscore + lowercase
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      // Convert to lowercase
      .toLowerCase()
      // Remove leading/trailing underscores
      .replace(/^_+|_+$/g, '')
  );
};

export const kebabCase = (str: string): string => {
  return (
    deburr(str)
      // Replace series of special characters with hyphens
      .replace(/[^a-zA-Z0-9]+/g, '-')
      // Replace capital letters preceded by lowercase or numbers with hyphen + lowercase
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      // Convert to lowercase
      .toLowerCase()
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, '')
  );
};

/**
 * Normalise a string to a PEP 503 distribution name.
 *
 * PEP 503 (https://peps.python.org/pep-0503/#normalized-names) defines the
 * canonical form of a Python project distribution name: lower-cased, with any
 * run of `.`, `_` or `-` collapsed to a single `-`. This is the name uv writes
 * into `uv.lock` and the form `@nxlv/python` expects when inferring workspace
 * dependency edges from `[project].dependencies` / `[tool.uv.sources]`.
 *
 * Importantly this is NOT kebab-case: it does not split on camelCase humps,
 * spaces or other punctuation, so a dotted nx id like `scope.my_lib` becomes
 * `scope-my-lib` (and only those three separators are touched).
 *
 * eg. `sojourner.agent_connection` -> `sojourner-agent-connection`
 */
export const normalizeDistributionName = (str: string): string =>
  str.toLowerCase().replace(/[._-]+/g, '-');

// Convert a string to a dot notation string (eg. lambda_handler/my_handler.py -> lambda_handler.my_handler)
export const toDotNotation = (str: string): string =>
  str
    ?.replace(/^\/|\/$/g, '') // Remove leading/trailing slashes
    .replace(/\.[^/.]+$/g, '') // Remove any file extensions
    .split('/')
    .filter(Boolean) // Remove empty segments (in case of double slashes)
    .join('.');
