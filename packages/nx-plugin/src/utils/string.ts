

/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export const uniq = <T>(items: T[]): T[] => {
  const itemSet = new Set<T>();
  return items.filter(item => {
    if (itemSet.has(item)) {
      return false;
    }
    itemSet.add(item);
    return true;
  });
};
