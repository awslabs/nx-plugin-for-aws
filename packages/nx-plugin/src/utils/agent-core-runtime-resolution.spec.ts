/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AGENT_CORE_RUNTIME_CEILINGS,
  agentCoreRuntimeIdentifierVersion,
  resolveAgentCoreRuntimes,
  unresolvedAgentCoreRuntimeWarning,
} from './agent-core-runtime-resolution.js';
import { compareRuntimeVersions } from './runtime-resolution.js';
import {
  AGENT_CORE_RUNTIME_VERSIONS,
  type IAgentCoreRuntime,
} from './versions.js';

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

  // `aws-cdk-lib` publishes an `AgentCoreRuntime` member when CDK adds it, not
  // when AgentCore makes the runtime generally available — the same thing
  // `Runtime.ALL` did with python3.15 and nodejs26.x. A ceiling is how this repo
  // declines such a member; nothing else would catch it, since the member exists
  // in CDK by definition.
  describe('holding a runtime below its ceiling', () => {
    const CEILINGS = {
      python: {
        ceiling: '3.14',
        reason: 'the service has no 3.15 yet',
        liftWhen: 'AgentCore accepts PYTHON_3_15',
      },
    };

    it('should keep the pin when CDK lists a runtime above the ceiling', () => {
      const { versions, unresolved } = resolveAgentCoreRuntimes(
        [...CDK_IDENTIFIERS, 'PYTHON_3_15'],
        CEILINGS,
      );

      expect(versions.python).toBe(AGENT_CORE_RUNTIME_VERSIONS.python);
      expect(unresolved).toEqual([
        {
          language: 'python',
          kept: AGENT_CORE_RUNTIME_VERSIONS.python,
          reason: 'held-below-ceiling',
          detail: 'the service has no 3.15 yet',
          liftWhen: 'AgentCore accepts PYTHON_3_15',
        },
      ]);
    });

    it('should warn with the reason and the lift condition', () => {
      const { unresolved } = resolveAgentCoreRuntimes(
        [...CDK_IDENTIFIERS, 'PYTHON_3_15'],
        CEILINGS,
      );
      const warning = unresolvedAgentCoreRuntimeWarning(unresolved[0]);

      expect(warning).toContain('AgentCore');
      expect(warning).toContain('the service has no 3.15 yet');
      expect(warning).toContain('Lift when AgentCore accepts PYTHON_3_15');
    });

    it('should still move a language with no ceiling', () => {
      const { versions, unresolved } = resolveAgentCoreRuntimes(
        [...CDK_IDENTIFIERS, 'NODE_24', 'PYTHON_3_15'],
        CEILINGS,
      );

      expect(versions.node).toBe('24');
      expect(unresolved.map((entry) => entry.language)).toEqual(['python']);
    });

    // A ceiling below the pin it caps is inert, because the resolution never
    // moves a runtime backwards, yet it reads as a hold.
    it('should ship no ceiling below the runtime it caps', () => {
      const inert: string[] = [];

      for (const language of Object.keys(
        AGENT_CORE_RUNTIME_VERSIONS,
      ) as IAgentCoreRuntime[]) {
        const held = AGENT_CORE_RUNTIME_CEILINGS[language];
        const pin = AGENT_CORE_RUNTIME_VERSIONS[language];
        if (held && compareRuntimeVersions(held.ceiling, pin) < 0) {
          inert.push(`${language}: ceiling ${held.ceiling} below pin ${pin}`);
        }
      }

      expect(inert).toEqual([]);
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
