/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import camelCase from 'lodash.camelcase';
import kebabCase from 'lodash.kebabcase';
import snakeCase from 'lodash.snakecase';

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
