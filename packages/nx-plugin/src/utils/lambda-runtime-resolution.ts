/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type RuntimeCeiling,
  type RuntimeResolution,
  resolveRuntimeVersions,
  type UnresolvedRuntime,
} from './runtime-resolution.js';
import { type ILambdaRuntime, LAMBDA_RUNTIME_VERSIONS } from './versions.js';

/**
 * Resolution of the managed Lambda runtimes the version update pins.
 *
 * Lives here rather than beside the script so it is covered by the plugin's test
 * suite; the script supplies the runtime list `aws-cdk-lib` publishes as
 * `Runtime.ALL`. The capping and reporting are shared with the AgentCore
 * resolution in `runtime-resolution.ts`.
 */

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
 * Lifting a ceiling takes three edits in the same change: raise it here, bump
 * {@link LAMBDA_RUNTIME_VERSIONS} by hand, and retag the vended Dockerfiles.
 * Raising the ceiling alone only lets the next version update move the pin, and
 * until the pin moves `lambda-runtimes.spec.ts` fails on any base image tag that
 * disagrees with it. Each entry's `liftWhen` names the event to wait for.
 *
 * An existing workspace needs more than that. `sync-embedded-versions.ts`
 * rewrites a `FROM <repo>:<tag>` line only for a repository in `BASE_IMAGES`,
 * which holds `docker/library` images, so nothing syncs a
 * `public.ecr.aws/lambda/*` tag into a workspace that has already been
 * generated: after an upgrade it would copy a bundle built for the new runtime
 * into an image still running the old interpreter. A lift therefore also needs a
 * migration that retags those Dockerfiles, or those images added to the
 * `BASE_IMAGES` pin manifest the sync reads.
 *
 * These runtimes are written by hand where no test can reach them, so they move
 * in the same change too:
 *
 * - `BASE_IMAGES.python` in `versions.ts`, a `docker/library` image rather than
 *   a Lambda base image, so the base image guard's pattern does not cover it
 * - the e2e greengrass and dungeon-adventure recipe templates, which write
 *   `Run: python3.14`, and the dungeon-adventure story agent templates, which
 *   write `AgentCoreRuntime.PYTHON_3_14`
 * - `docs/.../get_started/tutorials/dungeon-game/1.mdx` in every locale, which
 *   names `Runtime.NODEJS_24_X` and `AgentCoreRuntime.PYTHON_3_14`, plus the
 *   greengrass tutorial and guide pages, which name `python3.14` in prose
 */
export const LAMBDA_RUNTIME_CEILINGS: Partial<
  Record<ILambdaRuntime, RuntimeCeiling>
> = {
  node: {
    ceiling: '24',
    reason:
      'the vended TypeScript Dockerfile still names public.ecr.aws/lambda/nodejs:24',
    liftWhen:
      'public.ecr.aws/lambda/nodejs:26 is published, so the vended Dockerfile can be retagged in the same change',
  },
  python: {
    ceiling: '3.14',
    reason:
      'AgentCore Runtime has no Python 3.15, and the AgentCore code package ships the Lambda-targeted bundle',
    liftWhen: 'AgentCoreRuntime publishes PYTHON_3_15',
  },
};

/**
 * The runtime each language in {@link LAMBDA_RUNTIME_VERSIONS} resolves to, from
 * the runtime identifiers `aws-cdk-lib` publishes.
 *
 * Capped at {@link LAMBDA_RUNTIME_CEILINGS}, which the tests replace with their
 * own.
 */
export const resolveLambdaRuntimes = (
  identifiers: readonly string[],
  ceilings: Partial<
    Record<ILambdaRuntime, RuntimeCeiling>
  > = LAMBDA_RUNTIME_CEILINGS,
): RuntimeResolution =>
  resolveRuntimeVersions({
    current: LAMBDA_RUNTIME_VERSIONS,
    identifiers,
    parse: runtimeIdentifierVersion,
    ceilings,
  });

/** The warning a language's unresolved runtime reports. */
export const unresolvedRuntimeWarning = (entry: UnresolvedRuntime): string =>
  entry.reason === 'held-below-ceiling'
    ? `Holding the ${entry.language} runtime at ${entry.kept} although aws-cdk-lib lists a newer one: ${entry.detail}. Lift when ${entry.liftWhen}`
    : `Found no ${entry.language} runtime in the aws-cdk-lib runtime list, so it keeps its pinned runtime (${entry.kept})`;
