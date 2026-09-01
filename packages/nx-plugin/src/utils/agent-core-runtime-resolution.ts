/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  compareRuntimeVersions,
  type RuntimeResolution,
} from './lambda-runtime-resolution.js';
import {
  AGENT_CORE_RUNTIME_VERSIONS,
  type IAgentCoreRuntime,
} from './versions.js';

/**
 * Resolution of the managed AgentCore Runtime runtimes the version update pins.
 *
 * Lives here rather than beside the script so it is covered by the plugin's test
 * suite; the script supplies the runtime list read from `aws-cdk-lib`.
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
 * The latest managed runtime for each language in
 * {@link AGENT_CORE_RUNTIME_VERSIONS}, from the runtime identifiers
 * `aws-cdk-lib` publishes as `AgentCoreRuntime` members.
 *
 * Mirrors the Lambda resolution: the member list is curated, so a runtime still
 * in preview does not appear. Never moves a runtime backwards, and a language
 * the list says nothing about keeps its current pin and is reported through
 * `unresolved`, so a failure costs this bump alone.
 */
export const resolveAgentCoreRuntimes = (
  identifiers: readonly string[],
): RuntimeResolution => {
  const unresolved: RuntimeResolution['unresolved'][number][] = [];

  const versions = Object.fromEntries(
    (Object.keys(AGENT_CORE_RUNTIME_VERSIONS) as IAgentCoreRuntime[]).map(
      (language) => {
        const current = AGENT_CORE_RUNTIME_VERSIONS[language];
        const available = identifiers
          .map(agentCoreRuntimeIdentifierVersion)
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

/** The warning a language's unresolved AgentCore runtime reports. */
export const unresolvedAgentCoreRuntimeWarning = (
  entry: RuntimeResolution['unresolved'][number],
): string =>
  `Found no ${entry.language} runtime in the aws-cdk-lib AgentCoreRuntime list, so it keeps its pinned runtime (${entry.kept})`;
