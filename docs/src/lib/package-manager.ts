/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The package manager the reader has picked, shared across the site.
 *
 * Every command on a guide sits in a Starlight `<Tabs syncKey="cli-command">`,
 * which persists the chosen tab under its own storage key. The graph builder
 * isn't made of those tabs — it's one React island with its own controls — so it
 * reads and writes the same key, and a choice made in either place holds
 * everywhere.
 */
import { PACKAGE_MANAGERS } from './command-card';

/** Matches Starlight's `#storageKeyPrefix` in its Tabs component. */
const STORAGE_KEY = 'starlight-synced-tabs__cli-command';

export const PACKAGE_MANAGER_LABELS = PACKAGE_MANAGERS.map(
  (pm) => pm.label,
) as readonly string[];

export const readPackageManager = (fallback: string): string => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && PACKAGE_MANAGER_LABELS.includes(stored)
      ? stored
      : fallback;
  } catch {
    return fallback;
  }
};

export const writePackageManager = (packageManager: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, packageManager);
  } catch {
    // Nothing to fall back to; the choice just won't follow the reader.
  }
};
