/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import GeneratorsJson from '../../generators.json' with { type: 'json' };
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import {
  ALLOWED_TOOLS_MAX_ITEMS,
  ALLOWED_TOOLS_MIN_ITEMS,
  DEFAULT_HARNESS_ALLOWED_TOOLS,
  DEFAULT_HARNESS_DIRECTORY,
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
} from './resolve-options';
import harnessSchema from './schema.json' with { type: 'json' };

/**
 * Documentation contract checks (requirements 12.1-12.10).
 *
 * These tests read the committed English guide and the README rendered by
 * the generator and pin the facts both documents must state: registry
 * association, exact creation defaults, option coverage, emitted API names,
 * security wording, session bounds, follow-up scope, and the
 * generation-only lifecycle. Drift between documentation and generator
 * behaviour then fails CI instead of shipping stale docs. Building the
 * documentation site itself (requirement 14.12) runs as `nx build docs`
 * in the contribution validation sequence, not inside this unit suite.
 */

const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const GUIDE_PATH = 'docs/src/content/docs/en/guides/agentcore-harness.mdx';

const readWorkspaceFile = (relativePath: string): string =>
  readFileSync(join(WORKSPACE_ROOT, relativePath), 'utf-8');

/** Escape a literal value for embedding in a RegExp source string. */
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Phrases that would claim generation deploys or touches a live Harness.
 * Requirement 12.10 forbids these claims in both the public guide and the
 * generated README; the matching positive statements are asserted in the
 * generation-only tests below.
 */
const AUTO_DEPLOY_CLAIMS: RegExp[] = [
  /deploys? automatically/i,
  /deploy(?:ed|ing) automatically/i,
  /automatically deploy(?:s|ed|ing)?/i,
  /auto-?deploys?/i,
];

describe('agentcore-harness documentation contract', () => {
  describe('English guide', () => {
    const guide = readWorkspaceFile(GUIDE_PATH);

    it('associates the guide with the generator through frontmatter and registration metadata', () => {
      // Requirement 12.1: frontmatter carries a title and the generator
      // association; generators.json points back at this guide page.
      const frontmatter = guide.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      expect(frontmatter).toMatch(/^title:\s*\S/m);
      expect(frontmatter).toMatch(/^generator:\s*agentcore-harness\s*$/m);

      const registration = (
        GeneratorsJson.generators as Record<string, { guidePages?: string[] }>
      )['agentcore-harness'];
      expect(registration?.guidePages).toEqual(['agentcore-harness']);
    });

    it('is linked from the documentation site sidebar', () => {
      const astroConfig = readWorkspaceFile('docs/astro.config.mjs');
      expect(astroConfig).toContain("'/guides/agentcore-harness'");
    });

    it('documents every schema option', () => {
      // Requirement 12.2: the GeneratorParameters component auto-renders
      // every schema option (including preferInstallDependencies)...
      expect(guide).toContain(
        '<GeneratorParameters generator="agentcore-harness" />',
      );
      // ...and every other option also appears in the guide text itself
      // (defaults table and surrounding prose).
      const optionsInProse = Object.keys(harnessSchema.properties).filter(
        (option) => option !== 'preferInstallDependencies',
      );
      for (const option of optionsInProse) {
        expect(guide, option).toContain(`\`${option}\``);
      }
    });

    it('documents the exact creation defaults', () => {
      // Requirement 12.2: defaults come from the same constants the
      // generator resolves, so a default change breaks this test until the
      // guide is updated.
      expect(guide).toMatch(
        new RegExp(
          `\\|\\s*\`modelId\`\\s*\\|\\s*\`${escapeRegExp(DEFAULT_HARNESS_MODEL_ID)}\`\\s*\\|`,
        ),
      );
      expect(guide).toMatch(
        new RegExp(
          `\\|\\s*\`systemPrompt\`\\s*\\|\\s*\`${escapeRegExp(DEFAULT_HARNESS_SYSTEM_PROMPT)}\`\\s*\\|`,
        ),
      );
      expect(guide).toContain(`\`['${DEFAULT_HARNESS_ALLOWED_TOOLS[0]}']\``);
      expect(guide).toContain(
        `accepts ${ALLOWED_TOOLS_MIN_ITEMS}–${ALLOWED_TOOLS_MAX_ITEMS} non-empty patterns`,
      );
      expect(guide).toContain(
        `project root \`${DEFAULT_HARNESS_DIRECTORY}/<name>\``,
      );
      // Omitted execution limits defer to the service defaults.
      expect(guide).toContain('the AgentCore service defaults apply');
      // infra / iac defaults and behaviour.
      expect(guide).toMatch(
        /\|\s*`infra`\s*\|\s*`agentcore` \(`none` skips infrastructure\)\s*\|/,
      );
      expect(guide).toMatch(
        /\|\s*`iac`\s*\|\s*`inherit` \(uses your workspace's configured provider\)\s*\|/,
      );
      // Explicit provider mismatches fail before writing files.
      expect(guide).toContain('naming both providers');
    });

    it('documents the generated output paths', () => {
      // Requirement 12.2: project files and provider infrastructure paths.
      for (const file of [
        'invoke.ts',
        'invoke-harness.ts',
        'tsconfig.json',
        'README.md',
        'project.json',
      ]) {
        expect(guide, file).toContain(file);
      }
      expect(guide).toContain('packages/common/constructs/src/app/harnesses/');
      expect(guide).toContain('packages/common/terraform/src/app/harnesses/');
      expect(guide).toContain('`agentcore.harnesses.<ClassName>`');
    });

    it('documents manual CDK and Terraform composition', () => {
      // Requirement 12.3: the user composes and deploys through their own
      // workflow; the generator is never instructed to deploy.
      expect(guide).toContain("new MyHarness(this, 'MyHarness')");
      expect(guide).toContain('module "my_harness"');
      expect(guide).toContain(
        'Deploy the stack with your infrastructure project as usual',
      );
      expect(guide).toContain(
        "Deploy with your Terraform project's plan/apply workflow as usual",
      );
    });

    it('documents the emitted CDK and Terraform API names', () => {
      // Requirements 12.7, 12.8: the extension points named in the guide
      // must match the APIs the templates actually emit.
      expect(guide).toMatch(/`grantInvokeAccess\(/);
      expect(guide).toMatch(/`addToRolePolicy\(/);
      expect(guide).toMatch(/`harnessArn`/);
      expect(guide).toMatch(/`executionRole`/);
      expect(guide).toMatch(/`modelResourceArns`/);
      expect(guide).toContain('`aws_bedrockagentcore.CfnHarness`');
      expect(guide).toContain('`aws_bedrockagentcore_harness`');
      expect(guide).toContain('`model_resource_arns`');
      expect(guide).toContain('`additional_execution_role_policy_statements`');
      expect(guide).toContain(
        'outputs `harness_id`, `harness_arn`, and `execution_role_arn`',
      );
    });

    it('documents exactly the two required invocation actions', () => {
      // Requirements 7.10, 12.7: InvokeHarness plus InvokeAgentRuntime on
      // the base Harness ARN, and nothing else, for invocation principals.
      expect(guide).toContain(
        'exactly `bedrock-agentcore:InvokeHarness` and `bedrock-agentcore:InvokeAgentRuntime` on the Harness ARN',
      );
      expect(guide).toContain(
        'grants exactly these two actions on the base Harness ARN',
      );
    });

    it('documents baseline permissions and the deliberate exclusions', () => {
      // Requirement 12.7: baseline grants...
      expect(guide).toContain('bedrock:InvokeModel');
      expect(guide).toContain('bedrock:InvokeModelWithResponseStream');
      expect(guide).toContain('`aws:SourceAccount` and `aws:SourceArn`');
      expect(guide).toContain('Amazon ECR Public authorization token');
      expect(guide).toContain('X-Ray');
      expect(guide).toContain('CloudWatch Logs');
      expect(guide).toContain('workload identity');
      expect(guide).toContain('Browser and Code Interpreter');
      // ...IAM inbound authorization as the MVP default...
      expect(guide).toContain('IAM inbound authorization');
      // ...and the exclusions: the runtime command permission plus
      // customer-owned resources, with least-privilege extension points.
      expect(guide).toContain(
        'deliberately exclude `bedrock-agentcore:InvokeAgentRuntimeCommand`',
      );
      expect(guide).toMatch(
        /customer-owned resources: Gateways, memory, .*secrets, and VPC resources/,
      );
      expect(guide).toContain('least-privilege');
    });

    it('warns that per-invocation overrides from untrusted callers need application-layer control', () => {
      // Requirements 3.9, 7.11, 12.8: deployment defaults vs
      // per-invocation overrides, and the trust caution.
      expect(guide).toContain('### Per-invocation overrides');
      expect(guide).toContain('deployment defaults');
      expect(guide).toContain(':::caution[Validate invocation overrides]');
      expect(guide).toContain(
        'validate and authorize them at the application layer',
      );
    });

    it('documents the native extension surface', () => {
      // Requirement 12.8: model providers, tools, memory, skills,
      // environments, truncation and custom JWT authorization.
      for (const surface of [
        'model providers',
        'tool',
        'memory',
        'skill',
        'environment',
        'truncation',
        'custom JWT authorization',
      ]) {
        expect(guide, surface).toContain(surface);
      }
    });

    it('documents direct HARNESS_ARN invocation and Runtime Configuration lookup', () => {
      // Requirement 12.4.
      expect(guide).toContain('HARNESS_ARN');
      expect(guide).toContain('without reading Runtime Configuration');
      expect(guide).toContain('RUNTIME_CONFIG_APP_ID');
      expect(guide).toContain(
        'If neither is set, the command fails with an error naming both options.',
      );
    });

    it('documents UUID sessions, the 33-100 bounds, and session continuity', () => {
      // Requirement 12.5.
      expect(guide).toContain('generates a fresh UUID');
      expect(guide).toContain('between 33 and 100 characters, inclusive');
      expect(guide).toContain(
        'Reuse the printed session ID to continue the same session',
      );
    });

    it('documents streamed output, metadata diagnostics, stop handling and non-zero failures', () => {
      // Requirement 12.6.
      expect(guide).toContain('stdout carries only the streamed response text');
      expect(guide).toContain('stderr carries diagnostics');
      expect(guide).toContain('`messageStop`');
      expect(guide).toContain('exits non-zero');
    });

    it('identifies Harness-to-Gateway and Harness-to-MCP generators as follow-up work', () => {
      // Requirement 12.9.
      expect(guide).toContain(
        'Harness-to-Gateway and Harness-to-MCP connection generators are follow-up work',
      );
      expect(guide).toContain('not part of this initial release');
    });

    it('states the generation-only lifecycle and makes no auto-deploy claims', () => {
      // Requirement 12.10.
      expect(guide).toContain('The generator only writes files');
      expect(guide).toContain(
        'nothing runs, validates, or invokes a live Harness during generation',
      );
      for (const claim of AUTO_DEPLOY_CLAIMS) {
        expect(guide).not.toMatch(claim);
      }
    });
  });

  describe('generated project README', () => {
    let readme: string;

    beforeAll(async () => {
      // Render the README through the real generator so the contract is
      // checked against generator output, not the raw template. `infra:
      // none` renders the identical README while skipping shared
      // infrastructure, keeping this suite fast.
      const tree = createTreeUsingTsSolutionSetup();
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });
      readme = tree.read('packages/my-harness/README.md', 'utf-8') ?? '';
    });

    it('renders the project identity with no unrendered template markup', () => {
      expect(readme).toContain('# MyHarness');
      expect(readme).toContain('nx run @proj/my-harness:invoke');
      expect(readme).not.toContain('<%');
    });

    it('documents direct and Runtime Configuration discovery', () => {
      // Requirement 12.4.
      expect(readme).toContain('HARNESS_ARN');
      expect(readme).toContain('Runtime Configuration is not read');
      expect(readme).toContain('RUNTIME_CONFIG_APP_ID');
      expect(readme).toContain('`harnesses.MyHarness`');
      expect(readme).toContain('fails with an error naming both options');
    });

    it('documents UUID sessions, the 33-100 bounds, and stderr session reporting', () => {
      // Requirement 12.5.
      expect(readme).toContain('generates a fresh UUID');
      expect(readme).toContain('between 33 and 100 characters, inclusive');
      expect(readme).toContain('printed to stderr');
    });

    it('documents output channels and non-zero exit semantics', () => {
      expect(readme).toContain(
        'stdout carries only the streamed response text',
      );
      expect(readme).toContain('stderr carries diagnostics');
      expect(readme).toContain('exits non-zero');
      expect(readme).toContain('`messageStop`');
    });

    it('documents exactly the two required invocation actions', () => {
      // Requirements 7.10, 12.7.
      expect(readme).toContain(
        'exactly `bedrock-agentcore:InvokeHarness` and `bedrock-agentcore:InvokeAgentRuntime` on the Harness ARN',
      );
    });

    it('states user ownership of generated files', () => {
      // Requirement 10.7 context: create-only files stay user-owned.
      expect(readme).toContain('are yours after generation');
      expect(readme).toContain('never overwrites');
    });

    it('states the generation-only lifecycle and makes no auto-deploy claims', () => {
      // Requirement 12.10.
      expect(readme).toContain('Generation only writes files.');
      expect(readme).toContain(
        'nothing in this project deploys, validates, or invokes a live Harness on its own',
      );
      for (const claim of AUTO_DEPLOY_CLAIMS) {
        expect(readme).not.toMatch(claim);
      }
    });
  });
});
