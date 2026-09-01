/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  agentCoreRuntimeIdentifierVersion,
  resolveAgentCoreRuntimes,
  unresolvedAgentCoreRuntimeWarning,
} from './agent-core-runtime-resolution.js';
import { AGENT_CORE_RUNTIME_VERSIONS } from './versions.js';

/**
 * The identifiers `aws-cdk-lib` publishes as `AgentCoreRuntime` members at the
 * pinned version, which the version update reads.
 */
const CDK_IDENTIFIERS = [
  'PYTHON_3_10',
  'PYTHON_3_11',
  'PYTHON_3_12',
  'PYTHON_3_13',
  'PYTHON_3_14',
  'NODE_22',
];

describe('agent core runtime resolution', () => {
  describe('agentCoreRuntimeIdentifierVersion', () => {
    it('should read the version from a versioned runtime identifier', () => {
      expect(agentCoreRuntimeIdentifierVersion('NODE_22')).toEqual({
        language: 'node',
        version: '22',
      });
      expect(agentCoreRuntimeIdentifierVersion('PYTHON_3_14')).toEqual({
        language: 'python',
        version: '3.14',
      });
    });

    it('should skip an identifier that is not a versioned runtime', () => {
      expect(agentCoreRuntimeIdentifierVersion('NODE')).toBeUndefined();
      expect(agentCoreRuntimeIdentifierVersion('PYTHON')).toBeUndefined();
      expect(agentCoreRuntimeIdentifierVersion('of')).toBeUndefined();
    });
  });

  describe('resolveAgentCoreRuntimes', () => {
    it('should hold the current pins against the runtimes CDK publishes today', () => {
      const { versions, unresolved } =
        resolveAgentCoreRuntimes(CDK_IDENTIFIERS);

      // The pins are the latest CDK offers, so a resolution is a no-op until
      // AgentCore ships a newer runtime.
      expect(versions).toEqual({ ...AGENT_CORE_RUNTIME_VERSIONS });
      expect(unresolved).toEqual([]);
    });

    it('should move a pin forward when a newer runtime appears', () => {
      const { versions } = resolveAgentCoreRuntimes([
        ...CDK_IDENTIFIERS,
        'NODE_24',
        'PYTHON_3_15',
      ]);

      expect(versions.node).toBe('24');
      expect(versions.python).toBe('3.15');
    });

    it('should never move a pin backwards', () => {
      const { versions } = resolveAgentCoreRuntimes(['NODE_18', 'PYTHON_3_10']);

      expect(versions).toEqual({ ...AGENT_CORE_RUNTIME_VERSIONS });
    });

    it('should keep a pin and report it when CDK lists no runtime for the language', () => {
      const { versions, unresolved } = resolveAgentCoreRuntimes(['NODE_22']);

      expect(versions.python).toBe(AGENT_CORE_RUNTIME_VERSIONS.python);
      expect(unresolved).toEqual([
        {
          language: 'python',
          kept: AGENT_CORE_RUNTIME_VERSIONS.python,
          reason: 'no-runtimes-listed',
        },
      ]);
    });

    it('should keep every pin when the runtime list could not be read', () => {
      const { versions, unresolved } = resolveAgentCoreRuntimes([]);

      expect(versions).toEqual({ ...AGENT_CORE_RUNTIME_VERSIONS });
      expect(unresolved).toHaveLength(
        Object.keys(AGENT_CORE_RUNTIME_VERSIONS).length,
      );
    });
  });

  describe('unresolvedAgentCoreRuntimeWarning', () => {
    it('should name the language and the pin it kept', () => {
      expect(
        unresolvedAgentCoreRuntimeWarning({
          language: 'node',
          kept: '22',
          reason: 'no-runtimes-listed',
        }),
      ).toContain('AgentCoreRuntime');
      expect(
        unresolvedAgentCoreRuntimeWarning({
          language: 'node',
          kept: '22',
          reason: 'no-runtimes-listed',
        }),
      ).toContain('22');
    });
  });
});
