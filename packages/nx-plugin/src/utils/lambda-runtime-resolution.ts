/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ILambdaRuntime, LAMBDA_RUNTIME_VERSIONS } from './versions.js';

/**
 * Resolution of the Lambda runtimes and the CPython patch the version update
 * pins.
 *
 * Lives here rather than beside the script so it is covered by the plugin's test
 * suite; the script supplies the runtime list and the uv output.
 */

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

/**
 * The version a managed runtime identifier names, or undefined for one that isn't
 * a versioned `nodejs`/`python` runtime.
 *
 * `nodejs24.x` -> `24`, `python3.14` -> `3.14`. The bare `nodejs` and
 * `nodejs4.3-edge` style identifiers carry no comparable version and are skipped.
 */
export const runtimeIdentifierVersion = (
  identifier: string,
): { language: ILambdaRuntime; version: string } | undefined => {
  const node = /^nodejs(\d+)\.x$/.exec(identifier);
  if (node) {
    return { language: 'node', version: node[1] };
  }
  const python = /^python(\d+\.\d+)$/.exec(identifier);
  return python ? { language: 'python', version: python[1] } : undefined;
};

/** Why a language's runtime could not be resolved. */
export type UnresolvedReason = 'no-runtimes-listed';

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
 * The latest managed runtime for each language in {@link LAMBDA_RUNTIME_VERSIONS},
 * from the runtime identifiers `aws-cdk-lib` publishes.
 *
 * `Runtime.ALL` is a curated list of the runtimes CDK supports, so a runtime still
 * in public preview does not appear — which is what makes it a usable source for a
 * generally-available runtime. Never moves a runtime backwards: a pin ahead of
 * what CDK offers stays.
 *
 * A language the list says nothing about keeps its current pin and is reported
 * through `unresolved`, so a failure costs this bump alone rather than the whole
 * version update.
 */
export const resolveLambdaRuntimes = (
  identifiers: readonly string[],
): RuntimeResolution => {
  const unresolved: RuntimeResolution['unresolved'][number][] = [];

  const versions = Object.fromEntries(
    (Object.keys(LAMBDA_RUNTIME_VERSIONS) as ILambdaRuntime[]).map(
      (language) => {
        const current = LAMBDA_RUNTIME_VERSIONS[language];
        const available = identifiers
          .map(runtimeIdentifierVersion)
          .filter((parsed) => parsed?.language === language)
          .map((parsed) => parsed!.version);

        if (available.length === 0) {
          unresolved.push({
            language,
            kept: current,
            reason: 'no-runtimes-listed',
          });
          return [language, current];
        }

        const latest = available.reduce((best, version) =>
          compareRuntimeVersions(version, best) > 0 ? version : best,
        );

        return [
          language,
          compareRuntimeVersions(latest, current) > 0 ? latest : current,
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
  `Found no ${entry.language} runtime in the aws-cdk-lib runtime list, so it keeps its pinned runtime (${entry.kept})`;
