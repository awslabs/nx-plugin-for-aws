/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjects, type Tree } from '@nx/devkit';
import { getPythonAgentConnectionModuleName } from '../../../utils/agent-connection/agent-connection.js';
import {
  PY_AGENT_GUARDRAIL_VERIFIER_DEPENDENCIES,
  PY_VERIFIER_TYPE_CHECKER,
} from '../../../utils/test/python-dependencies.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { pyenvPythonVersion } from '../../../utils/versions.js';
import { pyProjectGenerator } from '../../project/generator.js';
import { pyAgentGenerator } from '../generator.js';
import { pyAgentGuardrailsGenerator } from './generator.js';

const RUN_CHECKS = path.join(
  import.meta.dirname,
  'runtime-check',
  'run_checks.py',
);
const FAKE_AWS = path.join(
  import.meta.dirname,
  '../../../utils/test/fake-aws/fake_aws.py',
);

interface ModelRequest {
  path: string;
  modelId: string;
  guardrailConfig: Record<string, string> | null;
  userTexts: string[];
  intervened: boolean;
}

interface ScenarioResult {
  calls: { models: ModelRequest[]; appConfigCalls: number }[];
  models: ModelRequest[];
  appConfigCalls: number;
  warnings: string[];
  error?: { type: string; message: string };
  streamed?: ModelRequest[];
  crashed?: number;
  stderr?: string;
}

type Results = Record<string, ScenarioResult> & {
  static: Record<string, { code: number; output: string }>;
};

/** Copy every file under `dir` in the tree to the same relative path under `dest`. */
const writeTreeDir = (tree: Tree, dir: string, dest: string) => {
  const visit = (current: string) => {
    for (const child of tree.children(current)) {
      const childPath = `${current}/${child}`;
      if (tree.isFile(childPath)) {
        const target = path.join(dest, path.relative(dir, childPath));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, tree.read(childPath));
      } else {
        visit(childPath);
      }
    }
  };
  visit(dir);
};

/** The environment of a run: no real AWS credentials or endpoints, only the stand-in. */
const isolatedEnv = (): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_')),
  );
  return {
    ...env,
    AWS_ACCESS_KEY_ID: 'dummy',
    AWS_SECRET_ACCESS_KEY: 'dummy',
    AWS_REGION: 'us-east-1',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    AWS_CONFIG_FILE: '/dev/null',
    AWS_MAX_ATTEMPTS: '1',
    // fake_aws.py is imported from the source tree; keep __pycache__ out of it.
    PYTHONDONTWRITEBYTECODE: '1',
  };
};

const AGENTS = {
  strands: { name: 'strands-agent', className: 'StrandsAgent' },
  langchain: { name: 'langchain-agent', className: 'LangchainAgent' },
} as const;

describe('guardrail.py at runtime', { timeout: 600_000 }, () => {
  const results: Partial<Record<keyof typeof AGENTS, Results>> = {};
  let workDir: string;

  beforeAll(async () => {
    const tree = createTreeUsingTsSolutionSetup();
    await pyProjectGenerator(tree, {
      name: 'agents',
      directory: 'packages',
      type: 'application',
    });
    const [projectName, project] = [...getProjects(tree)].find(
      ([, config]) => config.root === 'packages/agents',
    );
    for (const framework of ['strands', 'langchain'] as const) {
      await pyAgentGenerator(tree, {
        project: projectName,
        name: AGENTS[framework].name,
        framework,
        infra: 'none',
        session: 'in-memory',
        iac: 'cdk',
        preferInstallDependencies: false,
      });
      await pyAgentGuardrailsGenerator(tree, {
        project: projectName,
        agent: AGENTS[framework].name,
      });
    }

    workDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'py-guardrail-')),
    );
    const projectRoot = path.join(workDir, 'project');
    const connectionRoot = path.join(workDir, 'connection');
    const moduleName = path.basename(project.sourceRoot);
    const connectionModule = getPythonAgentConnectionModuleName(tree);
    writeTreeDir(tree, project.sourceRoot, path.join(projectRoot, moduleName));
    fs.writeFileSync(
      path.join(projectRoot, 'pyproject.toml'),
      tree.read(`${project.root}/pyproject.toml`),
    );
    writeTreeDir(
      tree,
      `packages/common/agent_connection/${connectionModule}`,
      path.join(connectionRoot, connectionModule),
    );

    const withDeps = [
      ...PY_AGENT_GUARDRAIL_VERIFIER_DEPENDENCIES,
      PY_VERIFIER_TYPE_CHECKER,
    ].flatMap((dep) => ['--with', dep]);
    for (const framework of ['strands', 'langchain'] as const) {
      const agentPackage = `${moduleName}.${AGENTS[framework].name.replace('-', '_')}`;
      const output = execFileSync(
        'uv',
        [
          'run',
          '--no-project',
          '--python',
          pyenvPythonVersion(),
          ...withDeps,
          'python',
          RUN_CHECKS,
          projectRoot,
          connectionRoot,
          FAKE_AWS,
          framework,
          agentPackage,
          connectionModule,
        ],
        {
          cwd: workDir,
          env: isolatedEnv(),
          encoding: 'utf-8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: 540_000,
        },
      );
      const line = output.split('\n').find((l) => l.startsWith('RESULTS '));
      results[framework] = JSON.parse(line.slice('RESULTS '.length));
    }
  }, 1_200_000);

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  describe.each(['strands', 'langchain'] as const)('%s', (framework) => {
    const { className, name } = AGENTS[framework];
    const key = `agentcore.guardrails.${className}`;
    const guarded = (version: string) => ({
      guardrailIdentifier: 'grtest',
      guardrailVersion: version,
      trace: 'enabled',
    });
    const result = (scenario: string): ScenarioResult => {
      const r = results[framework][scenario];
      expect(r.crashed, r.stderr).toBeUndefined();
      return r;
    };

    it('should send the guardrail from runtime config with each model request', () => {
      const r = result('guarded');

      expect(r.error).toBeUndefined();
      expect(r.models.length).toBeGreaterThan(0);
      for (const request of r.models) {
        expect(request.guardrailConfig).toEqual(guarded('1'));
        expect(request.modelId).toBe(
          framework === 'strands'
            ? 'global.anthropic.claude-sonnet-4-6'
            : 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        );
      }
      if (framework === 'langchain') {
        expect(r.streamed).toHaveLength(1);
        expect(r.streamed[0].path).toBe('converse-stream');
        expect(r.streamed[0].guardrailConfig).toEqual(guarded('1'));
      }
    });

    it('should use a changed entry on the same model after the cache time', () => {
      const r = result('reread');

      expect(r.error).toBeUndefined();
      const [first, second, third] = r.calls;
      expect(first.models.at(-1).guardrailConfig).toEqual(guarded('1'));
      // Within the 5 second cache: the old version, and no new AppConfig read.
      expect(second.models.at(-1).guardrailConfig).toEqual(guarded('1'));
      expect(second.appConfigCalls).toBe(first.appConfigCalls);
      expect(third.models.at(-1).guardrailConfig).toEqual(guarded('2'));
      expect(third.appConfigCalls).toBeGreaterThan(second.appConfigCalls);
    });

    it('should fail with the missing-entry error and send no model request', () => {
      const r = result('missing');

      expect(r.error).toEqual({
        type: 'RuntimeError',
        message: `No guardrail for this agent in runtime config at ${key}. Add the ${className}Guardrail construct (CDK) or the guardrails/${name} module (Terraform) to your infrastructure.`,
      });
      expect(r.models).toEqual([]);
    });

    it("should propagate the reader's error when RUNTIME_CONFIG_APP_ID is not set", () => {
      const r = result('no-app-id');

      expect(r.error).toEqual({
        type: 'RuntimeError',
        message:
          'RUNTIME_CONFIG_APP_ID is not set — cannot resolve connected agent ARNs from AppConfig.',
      });
      expect(r.models).toEqual([]);
    });

    it('should warn once and run unguarded in local dev without RUNTIME_CONFIG_APP_ID', () => {
      const r = result('local-dev');

      expect(r.error).toBeUndefined();
      expect(r.warnings).toEqual([
        `No guardrail for this agent in runtime config at ${key}, so the agent is running without a guardrail (LOCAL_DEV=true).`,
      ]);
      expect(r.calls).toHaveLength(2);
      expect(r.models.length).toBeGreaterThanOrEqual(2);
      for (const request of r.models) {
        expect(request.guardrailConfig).toBeNull();
      }
      expect(r.appConfigCalls).toBe(0);
    });

    it('should warn once and run unguarded in local dev when the read fails', () => {
      const r = result('local-dev-broken');

      expect(r.error).toBeUndefined();
      expect(r.warnings).toHaveLength(1);
      expect(r.appConfigCalls).toBeGreaterThan(0);
      for (const request of r.models) {
        expect(request.guardrailConfig).toBeNull();
      }
    });

    it('should apply the guardrail in local dev when runtime config has it', () => {
      const r = result('local-dev-guarded');

      expect(r.error).toBeUndefined();
      expect(r.warnings).toEqual([]);
      expect(r.models.at(-1).guardrailConfig).toEqual(guarded('1'));
    });

    it.each([
      ['draft', 'DRAFT'],
      ['draft-local', 'DRAFT'],
      ['zero', '0'],
      ['zero-local', '0'],
    ])(
      'should reject a version that is not numbered (%s)',
      (scenario, version) => {
        const r = result(scenario);

        expect(r.error).toEqual({
          type: 'RuntimeError',
          message: `The guardrail version in runtime config at ${key} must be a numbered guardrail version, but is ${version}.`,
        });
        expect(r.models).toEqual([]);
      },
    );

    it('should send the guardrail on every concurrent request on one model', () => {
      const r = result('concurrent');

      expect(r.error).toBeUndefined();
      expect(r.models).toHaveLength(10);
      for (const request of r.models) {
        expect(request.guardrailConfig).toEqual(guarded('1'));
      }
    });

    it.each(['blocked-session', 'blocked-session-stream'])(
      'should answer a normal message after a blocked one in the same session (%s)',
      (scenario) => {
        const r = result(scenario);

        expect(r.error).toBeUndefined();
        const [blocked, next] = r.calls;
        expect(blocked.models.at(-1).intervened).toBe(true);
        const followUps = next.models.slice(blocked.models.length);
        expect(followUps.length).toBeGreaterThan(0);
        for (const request of followUps) {
          expect(request.guardrailConfig).toEqual(guarded('1'));
          // fake_aws.py blocks it as Bedrock would if the blocked message were still checked.
          expect(request.intervened).toBe(false);
        }
        // The session keeps the earlier turn, with the blocked message redacted.
        expect(followUps[0].userTexts).toEqual([
          '[User input redacted.]',
          '2+2?',
        ]);
      },
    );

    it.each(['ty', 'ruffFormat', 'ruffCheck'])(
      'should pass %s on guardrail.py and agent.py',
      (check) => {
        const { code, output } = results[framework].static[check];

        expect(output).not.toMatch(/error\[|would reformat/);
        expect(code, output).toBe(0);
      },
    );
  });
});
