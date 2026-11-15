/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  TargetConfiguration,
  TargetDefaultArrayEntry,
  TargetDefaults,
  TargetDefaultValue,
} from '@nx/devkit';

// Frozen copy of `withVitestTestTargetDefaults` (ts/lib/vitest.ts) and
// `mergePluginTargetDefault` (utils/nx.ts). A released migration must keep
// writing the same nx.json, so later changes to those helpers must not reach it.

/** The nx.json plugin that infers each vitest project's `test` target. */
export const VITEST_PLUGIN = '@nx/vitest';

/** Whether `entry` is filtered to exactly the targets {@link VITEST_PLUGIN} infers. */
export const isVitestPluginEntry = ({ filter }: TargetDefaultArrayEntry) =>
  filter !== undefined &&
  Object.keys(filter).length === 1 &&
  filter.plugin === VITEST_PLUGIN;

/**
 * Merge `apply`'s config into the `targetDefaults` entry filtered to
 * {@link VITEST_PLUGIN}. The result is the array form: an object value becomes
 * the catch-all first entry, and the plugin's entry is merged in place or
 * appended. Other entries keep their content and order.
 */
const mergeVitestPluginTargetDefault = (
  value: TargetDefaultValue | undefined,
  apply: (base: Partial<TargetConfiguration>) => Partial<TargetConfiguration>,
): TargetDefaultArrayEntry[] => {
  const entries: TargetDefaultArrayEntry[] =
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  const pluginIndex = entries.findIndex(isVitestPluginEntry);
  if (pluginIndex === -1) {
    return [...entries, { filter: { plugin: VITEST_PLUGIN }, ...apply({}) }];
  }
  return entries.map((entry, index) => {
    if (index !== pluginIndex) {
      return entry;
    }
    const { filter, ...base } = entry;
    return { filter, ...apply(base) };
  });
};

/**
 * Add the vitest test defaults (caching, inputs and the `update-snapshot`
 * configuration) to `targetDefaults.test`, in an entry filtered to the `test`
 * targets {@link VITEST_PLUGIN} infers.
 *
 * Later values win: the vended defaults, then `carried` (values moved from the
 * removed `@nx/vitest:test` key), then whatever the entry already holds.
 */
export const withVitestTestTargetDefaults = (
  targetDefaults: TargetDefaults | undefined,
  carried?: Partial<TargetConfiguration>,
): TargetDefaults => ({
  ...targetDefaults,
  test: mergeVitestPluginTargetDefault(targetDefaults?.test, (base) => ({
    cache: true,
    inputs: ['default', '^production'],
    configurations: {
      'update-snapshot': {
        args: '--update',
      },
    },
    ...carried,
    ...base,
  })),
});
