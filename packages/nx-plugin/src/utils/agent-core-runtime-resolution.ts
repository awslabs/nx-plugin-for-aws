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
import {
  AGENT_CORE_RUNTIME_VERSIONS,
  type IAgentCoreRuntime,
} from './versions.js';

/**
 * Resolution of the managed AgentCore Runtime runtimes the version update pins.
 *
 * Lives here rather than beside the script so it is covered by the plugin's test
 * suite; the script supplies the runtime list read from `aws-cdk-lib`. The
 * capping and reporting are shared with the Lambda resolution in
 * `runtime-resolution.ts`.
 */

/**
 * The version an AgentCore runtime identifier names, or undefined for one that
 * isn't a versioned `NODE`/`PYTHON` runtime.
 *
 * `NODE_22` -> `22`, `PYTHON_3_14` -> `3.14`.
 */
export const agentCoreRuntimeIdentifierVersion = (
  identifier: string,
): { language: IAgentCoreRuntime; version: string } | undefined => {
  const node = /^NODE_(\d+)$/.exec(identifier);
  if (node) {
    return { language: 'node', version: node[1] };
  }
  const python = /^PYTHON_(\d+)_(\d+)$/.exec(identifier);
  return python
    ? { language: 'python', version: `${python[1]}.${python[2]}` }
    : undefined;
};

/**
 * AgentCore runtimes deliberately kept below what `aws-cdk-lib` offers, and why.
 *
 * Empty today, because the members the pinned `aws-cdk-lib` publishes
 * (`PYTHON_3_10` to `PYTHON_3_14` and `NODE_22`) are all runtimes AgentCore
 * accepts, so there is nothing to hold. The mechanism is here because this list
 * carries the same risk `Runtime.ALL` turned out to carry: `aws-cdk-lib`
 * publishes a member when CDK adds it, not when the service makes the runtime
 * generally available. Without a ceiling, a preview member would be written into
 * `AGENT_CORE_RUNTIME_VERSIONS` by the next weekly run, vended by
 * `agentCoreRuntime()`, and rejected when AgentCore creates the runtime — and
 * nothing local would catch it, since the member exists in CDK by definition.
 *
 * Hold one by adding an entry here, with the reason and the lift condition, both
 * of which reach the weekly PR body. Editing the pin in `versions.ts` instead
 * does not hold anything: the next run rewrites it.
 */
export const AGENT_CORE_RUNTIME_CEILINGS: Partial<
  Record<IAgentCoreRuntime, RuntimeCeiling>
> = {};

/**
 * The runtime each language in {@link AGENT_CORE_RUNTIME_VERSIONS} resolves to,
 * from the identifiers `aws-cdk-lib` publishes as `AgentCoreRuntime` members.
 *
 * Capped at {@link AGENT_CORE_RUNTIME_CEILINGS}, which the tests replace with
 * their own.
 */
export const resolveAgentCoreRuntimes = (
  identifiers: readonly string[],
  ceilings: Partial<
    Record<IAgentCoreRuntime, RuntimeCeiling>
  > = AGENT_CORE_RUNTIME_CEILINGS,
): RuntimeResolution =>
  resolveRuntimeVersions({
    current: AGENT_CORE_RUNTIME_VERSIONS,
    identifiers,
    parse: agentCoreRuntimeIdentifierVersion,
    ceilings,
  });

/** The warning a language's unresolved AgentCore runtime reports. */
export const unresolvedAgentCoreRuntimeWarning = (
  entry: UnresolvedRuntime,
): string =>
  entry.reason === 'held-below-ceiling'
    ? `Holding the ${entry.language} AgentCore runtime at ${entry.kept} although aws-cdk-lib lists a newer one: ${entry.detail}. Lift when ${entry.liftWhen}`
    : `Found no ${entry.language} runtime in the aws-cdk-lib AgentCoreRuntime list, so it keeps its pinned runtime (${entry.kept})`;
