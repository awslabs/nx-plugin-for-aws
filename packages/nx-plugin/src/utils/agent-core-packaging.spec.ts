/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentCoreNodeRuntime,
  agentCorePythonRuntime,
  isAgentCoreHosted,
  isContainerHosted,
  PYTHON_AGENT_CORE_LAUNCHER,
  pythonAgentCoreLauncher,
} from './agent-core-packaging.js';
import { AGENT_CORE_RUNTIME_VERSIONS, PY_VERSIONS } from './versions.js';

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

  it.each([
    ['absolute Python shebang', '#!/nonexistent/build/python\n'],
    [
      'uv shell wrapper',
      "#!/bin/sh\n'''exec' '/nonexistent/build/python' \"$0\" \"$@\"\n' '''\n",
    ],
  ])(
    'runs instrumentation and the original entry point despite a broken %s',
    (_shape, script) => {
      const directory = mkdtempSync(join(tmpdir(), 'agentcore-launcher-'));
      try {
        const bin = join(directory, 'bin');
        mkdirSync(bin);
        const consoleScript = join(bin, 'opentelemetry-instrument');
        writeFileSync(consoleScript, script);
        chmodSync(consoleScript, 0o755);
        const broken = spawnSync(consoleScript);
        expect(broken.error !== undefined || broken.status !== 0).toBe(true);
        writeFileSync(
          join(directory, PYTHON_AGENT_CORE_LAUNCHER),
          pythonAgentCoreLauncher('custom_main.py'),
        );
        writeFileSync(
          join(directory, 'custom_main.py'),
          'import json, sys\nprint(json.dumps({"args": sys.argv[1:], "instrumented": "sitecustomize" in sys.modules}))\n',
        );
        const output = execFileSync(
          'uv',
          [
            'run',
            '--no-project',
            '--python',
            AGENT_CORE_RUNTIME_VERSIONS.python,
            '--with',
            `aws-opentelemetry-distro${PY_VERSIONS['aws-opentelemetry-distro']}`,
            'python',
            join(directory, PYTHON_AGENT_CORE_LAUNCHER),
            'original-argument',
          ],
          {
            cwd: directory,
            encoding: 'utf-8',
            env: {
              ...process.env,
              UV_PYTHON_PREFERENCE: 'system',
              PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
              OTEL_TRACES_EXPORTER: 'none',
              OTEL_METRICS_EXPORTER: 'none',
              OTEL_LOGS_EXPORTER: 'none',
            },
          },
        );
        expect(JSON.parse(output)).toEqual({
          args: ['original-argument'],
          instrumented: true,
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
