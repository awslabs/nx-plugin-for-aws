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
export type UnresolvedReason = 'no-runtimes-listed' | 'held-below-ceiling';

/**
 * Lambda runtimes deliberately kept below what `aws-cdk-lib` offers, and why.
 *
 * `Runtime.ALL` turned out not to be the generally-available list this
 * resolution assumed: `aws-cdk-lib` added `python3.15` in 2.276.0 (2026-11-10)
 * and `nodejs26.x` in 2.277.0 (2026-11-13), both while still in Lambda public
 * preview, and they only reached general availability on 2026-11-20. So a
 * ceiling is needed to decide in this repo when a runtime moves, rather than
 * inheriting the decision from a dependency bump.
 *
 * Both entries are held on the same change, because moving either needs work no
 * weekly bump does:
 *
 * - The Python interpreter the arm64 bundle installs wheels for comes from
 *   {@link LAMBDA_RUNTIME_VERSIONS}.`python` (`bundle.ts`), and that same bundle
 *   is what an AgentCore code package ships. AgentCore Runtime's newest Python
 *   is 3.14, so a Lambda pin of 3.15 builds cp315 wheels for a cp314 runtime.
 * - The vended Dockerfiles name their base image tag literally
 *   (`public.ecr.aws/lambda/python:3.14`, `public.ecr.aws/lambda/nodejs:24`), so
 *   a container-image function would keep running the old interpreter over a
 *   bundle built for the new one.
 *
 * Lift a ceiling by raising it here in the same change that moves the vended
 * base image tags, and, for Python, once `AgentCoreRuntime` publishes the
 * matching member.
 */
export const LAMBDA_RUNTIME_CEILINGS: Partial<
  Record<ILambdaRuntime, { readonly ceiling: string; readonly reason: string }>
> = {
  node: {
    ceiling: '24',
    reason:
      'the vended TypeScript Dockerfile still names public.ecr.aws/lambda/nodejs:24',
  },
  python: {
    ceiling: '3.14',
    reason:
      'AgentCore Runtime has no Python 3.15, and the AgentCore code package ships the Lambda-targeted bundle',
  },
};

export interface RuntimeResolution {
  /** Runtime version per language, holding the current pin where unresolved. */
  readonly versions: Record<string, string>;
  /** Languages left on their current pin, and why. */
  readonly unresolved: {
    readonly language: string;
    readonly kept: string;
    readonly reason: UnresolvedReason;
    /** For a held language, why it is held. */
    readonly detail?: string;
  }[];
}

/**
 * The latest managed runtime for each language in {@link LAMBDA_RUNTIME_VERSIONS},
 * from the runtime identifiers `aws-cdk-lib` publishes.
 *
 * `Runtime.ALL` is a curated list of the runtimes CDK supports, but it is not
 * limited to generally-available ones, so {@link LAMBDA_RUNTIME_CEILINGS} caps
 * each language at the newest runtime this repo has vetted. Never moves a
 * runtime backwards: a pin ahead of what CDK offers stays.
 *
 * A language the list says nothing about, or whose newest listed runtime is
 * above its ceiling, keeps its current pin and is reported through `unresolved`,
 * so a failure or a hold costs this bump alone rather than the whole version
 * update.
 */
export const resolveLambdaRuntimes = (
  identifiers: readonly string[],
  ceilings: typeof LAMBDA_RUNTIME_CEILINGS = LAMBDA_RUNTIME_CEILINGS,
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

        // Reported whenever the list offers something the ceiling refuses, so a
        // hold that has outlived its reason is visible in every PR body rather
        // than only in this file.
        const held = ceilings[language];
        if (held && compareRuntimeVersions(latest, held.ceiling) > 0) {
          unresolved.push({
            language,
            kept: current,
            reason: 'held-below-ceiling',
            detail: held.reason,
          });
          return [
            language,
            compareRuntimeVersions(held.ceiling, current) > 0
              ? held.ceiling
              : current,
          ];
        }

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
  entry.reason === 'held-below-ceiling'
    ? `Holding the ${entry.language} runtime at ${entry.kept} although aws-cdk-lib lists a newer one: ${entry.detail}`
    : `Found no ${entry.language} runtime in the aws-cdk-lib runtime list, so it keeps its pinned runtime (${entry.kept})`;
