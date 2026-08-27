/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ILambdaRuntime, LAMBDA_RUNTIME_VERSIONS } from './versions.js';

/**
 * Resolution of the latest generally-available managed Lambda runtimes, used by
 * the weekly version update.
 *
 * Lives here rather than beside the script so it is covered by the plugin's test
 * suite; the script keeps the `fetch` and the reporting around it.
 */

/** The AWS documentation page listing every managed Lambda runtime. */
export const LAMBDA_RUNTIMES_DOC_URL =
  'https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html';

/** A managed runtime as the supported-runtimes table describes it. */
export interface ManagedRuntime {
  /** Runtime identifier, e.g. `nodejs24.x`. */
  readonly identifier: string;
  /** Version as it appears in the identifier, e.g. `24` or `3.14`. */
  readonly version: string;
  /** Forecast deprecation date, or undefined when the table says "Not scheduled". */
  readonly deprecation?: Date;
}

/**
 * Every `nodejs`/`python` runtime in the supported-runtimes table, with its
 * forecast deprecation date.
 *
 * This table is the only source that distinguishes a generally-available runtime
 * from a preview one: the Lambda API accepts preview runtimes, and the botocore
 * `Runtime` enum carries no preview or deprecation metadata, so a resolver keyed
 * on "highest version wins" would pin a runtime with no SLA that AWS documents as
 * unfit for production.
 *
 * A dated deprecation marks a runtime GA — AWS publishes a lifecycle only once it
 * commits to supporting it, and previews read "Not scheduled". The date is parsed
 * rather than merely detected so an imminent deprecation can be skipped too.
 *
 * Returns an empty list for a page holding no runtime rows, which the caller
 * treats as unresolved.
 */
export const parseManagedRuntimes = (html: string): ManagedRuntime[] => {
  const cellsOf = (row: string): string[] =>
    [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((cell) =>
      cell[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim(),
    );

  const runtimes: ManagedRuntime[] = [];
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    // Name | Identifier | Operating system | Deprecation date | ...
    const cells = cellsOf(row[1]);
    if (cells.length < 4) {
      continue;
    }
    const [, identifier, , deprecation] = cells;
    const parsed = /^(nodejs|python)([0-9][0-9.]*?)(?:\.x)?$/.exec(identifier);
    if (!parsed) {
      continue;
    }
    const at = new Date(deprecation);
    runtimes.push({
      identifier,
      version: parsed[2],
      deprecation: Number.isNaN(at.getTime()) ? undefined : at,
    });
  }
  return runtimes;
};

/** Compare two dotted numeric versions (`24`, `3.14`) ascending. */
export const compareRuntimeVersions = (a: string, b: string): number => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

/** Why a language's runtime could not be resolved. */
export type UnresolvedReason = 'unreadable-page' | 'no-ga-runtime';

export interface RuntimeResolution {
  /** Runtime version per language, holding the current pin where unresolved. */
  readonly versions: Record<string, string>;
  /** Languages left on their current pin, and why. */
  readonly unresolved: {
    readonly language: string;
    readonly kept: string;
    readonly reason: UnresolvedReason;
  }[];
}

/**
 * The latest generally-available managed runtime for each language in
 * {@link LAMBDA_RUNTIME_VERSIONS}, alongside the languages it could not resolve.
 *
 * Only runtimes carrying a deprecation date are eligible, and one already past —
 * or within six months of — its date is skipped, matching the rule Lambda applies
 * to new regions. Never moves a runtime backwards: a pin ahead of what the table
 * offers stays.
 *
 * A language the table says nothing readable about keeps its current pin and is
 * reported through `unresolved`, so a page reshuffle costs this bump alone rather
 * than the whole version update. The two failure modes stay distinct: an
 * unreadable page against a page carrying no GA runtime.
 */
export const resolveLambdaRuntimes = (
  runtimes: readonly ManagedRuntime[],
  now: Date = new Date(),
): RuntimeResolution => {
  const horizon = new Date(now);
  horizon.setMonth(horizon.getMonth() + 6);
  const unresolved: RuntimeResolution['unresolved'][number][] = [];

  const versions = Object.fromEntries(
    (Object.keys(LAMBDA_RUNTIME_VERSIONS) as ILambdaRuntime[]).map(
      (language) => {
        const current = LAMBDA_RUNTIME_VERSIONS[language];
        const prefix = language === 'node' ? 'nodejs' : 'python';
        const generallyAvailable = runtimes.filter(
          (runtime) =>
            runtime.identifier.startsWith(prefix) &&
            runtime.deprecation !== undefined &&
            runtime.deprecation > horizon,
        );

        // Every language here has GA runtimes today, so an empty set means the
        // page no longer says what this reads.
        if (generallyAvailable.length === 0) {
          unresolved.push({
            language,
            kept: current,
            reason: runtimes.length === 0 ? 'unreadable-page' : 'no-ga-runtime',
          });
          return [language, current];
        }

        const latest = generallyAvailable.reduce((best, runtime) =>
          compareRuntimeVersions(runtime.version, best.version) > 0
            ? runtime
            : best,
        );

        return [
          language,
          compareRuntimeVersions(latest.version, current) > 0
            ? latest.version
            : current,
        ];
      },
    ),
  );

  return { versions, unresolved };
};

/** The warning a language's unresolved runtime reports. */
export const unresolvedRuntimeWarning = (
  entry: RuntimeResolution['unresolved'][number],
): string =>
  entry.reason === 'unreadable-page'
    ? `Could not read the Lambda runtimes table at ${LAMBDA_RUNTIMES_DOC_URL}, so ${entry.language} keeps its pinned runtime (${entry.kept})`
    : `Found no generally-available ${entry.language} runtime with a current deprecation date at ${LAMBDA_RUNTIMES_DOC_URL}, so it keeps its pinned runtime (${entry.kept})`;
