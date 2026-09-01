/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  agentCoreNodeRuntime,
  agentCorePythonRuntime,
  isAgentCoreHosted,
  isContainerHosted,
} from './agent-core-packaging.js';
import { AGENT_CORE_RUNTIME_VERSIONS } from './versions.js';

describe('agent core packaging utils', () => {
  describe('infra predicates', () => {
    it('should treat both agentcore variants as hosted', () => {
      expect(isAgentCoreHosted('agentcore')).toBe(true);
      expect(isAgentCoreHosted('agentcore-ecr')).toBe(true);
      expect(isAgentCoreHosted('none')).toBe(false);
    });

    it('should only treat agentcore-ecr as container hosted', () => {
      expect(isContainerHosted('agentcore-ecr')).toBe(true);
      expect(isContainerHosted('agentcore')).toBe(false);
      expect(isContainerHosted('none')).toBe(false);
    });
  });

  describe('managed runtimes', () => {
    it('should name the runtimes from the AgentCore pins', () => {
      expect(agentCoreNodeRuntime()).toBe(
        `NODE_${AGENT_CORE_RUNTIME_VERSIONS.node}`,
      );
      expect(agentCorePythonRuntime()).toBe(
        `PYTHON_${AGENT_CORE_RUNTIME_VERSIONS.python.replace('.', '_')}`,
      );
    });
  });
});
