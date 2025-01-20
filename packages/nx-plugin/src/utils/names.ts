/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import kebabCase from 'lodash.kebabcase';
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
