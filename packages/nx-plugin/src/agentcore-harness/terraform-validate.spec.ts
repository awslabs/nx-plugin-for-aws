/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

/**
 * Terraform CLI validation for the generated Harness module.
 *
 * Runs the real `terraform fmt -check` and `terraform validate`
 * (requirements 6.11, 14.6) against rendered modules. `terraform plan` and
 * `terraform apply` are never run, and `terraform validate` is offline with
 * respect to AWS: no credentials are used and no AWS endpoint is contacted.
 *
 * The repository does not guarantee a terraform binary in unit-test CI (no
 * other plugin spec shells out to terraform; generated-workspace e2e smoke
 * tests own the terraform project's `fmt`/`validate` Nx targets). This
 * suite therefore self-gates:
 *
 * - The suite runs when a terraform CLI is found via the `TERRAFORM_BIN`
 *   environment variable or `terraform` on the PATH, and is skipped with a
 *   console notice otherwise.
 * - `terraform init -backend=false` must download the pinned providers
 *   from the Terraform registry, which requires network access. When init
 *   fails with a network/registry error the test is skipped (not failed)
 *   with an explanatory note. A `TF_PLUGIN_CACHE_DIR` from the environment
 *   is honored; otherwise a suite-local cache is used so the providers are
 *   downloaded at most once across the three variants.
 */

const findTerraformBinary = (): string | undefined => {
  for (const candidate of [process.env.TERRAFORM_BIN, 'terraform']) {
    if (!candidate) {
      continue;
    }
    try {
      execFileSync(candidate, ['version'], { stdio: 'pipe' });
      return candidate;
    } catch {
      // Probe the next candidate.
    }
  }
  return undefined;
};

const terraformBin = findTerraformBinary();
if (!terraformBin) {
  console.warn(
    '[agentcore-harness terraform-validate.spec] no terraform CLI found ' +
      '(set TERRAFORM_BIN or add terraform to the PATH); skipping ' +
      'terraform fmt -check / terraform validate execution. Content-level ' +
      'coverage still runs in terraform-template.spec.ts, and generated ' +
      'workspaces run fmt/validate through the e2e smoke-test layer.',
  );
}

/** Stderr/stdout patterns that identify init failures caused by the network. */
const NETWORK_FAILURE_PATTERN =
  /Failed to query available provider packages|could not connect|no such host|dial tcp|context deadline exceeded|connection refused|name resolution|could not be reached|timeout|timed out/i;

const SHARED_TF_ROOT = 'packages/common/terraform/';

/**
 * Write the tree's shared terraform sources (the harness module plus the
 * local runtime-config modules it references) to a real directory so the
 * terraform CLI can run against them.
 */
const materializeSharedTerraformSrc = (tree: Tree, workDir: string): void => {
  const stack = [`${SHARED_TF_ROOT}src`];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of tree.children(current)) {
      const childPath = `${current}/${child}`;
      if (tree.isFile(childPath)) {
        const dest = join(workDir, childPath.substring(SHARED_TF_ROOT.length));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, tree.read(childPath)!);
      } else {
        stack.push(childPath);
      }
    }
  }
};

describe.skipIf(!terraformBin)(
  'agentcore-harness terraform fmt -check and validate (requires a terraform CLI)',
  () => {
    // Reuse one provider cache across the three variants so the pinned
    // providers are downloaded at most once per suite run. An externally
    // supplied TF_PLUGIN_CACHE_DIR wins.
    let suitePluginCacheDir: string | undefined;
    const workDirs: string[] = [];

    beforeAll(() => {
      if (!process.env.TF_PLUGIN_CACHE_DIR) {
        suitePluginCacheDir = mkdtempSync(
          join(tmpdir(), 'agentcore-harness-tf-cache-'),
        );
      }
    });

    afterAll(() => {
      for (const dir of workDirs) {
        rmSync(dir, { recursive: true, force: true });
      }
      if (suitePluginCacheDir) {
        rmSync(suitePluginCacheDir, { recursive: true, force: true });
      }
    });

    const runTerraform = (args: string[], cwd: string): string => {
      try {
        return execFileSync(terraformBin!, args, {
          cwd,
          stdio: 'pipe',
          encoding: 'utf-8',
          // Bounded below the vitest test timeout so a stalled provider
          // download surfaces as a classified error, not a test timeout.
          timeout: 100_000,
          env: {
            ...process.env,
            TF_IN_AUTOMATION: '1',
            TF_PLUGIN_CACHE_DIR:
              process.env.TF_PLUGIN_CACHE_DIR ?? suitePluginCacheDir,
            // Allow the cache to satisfy providers that are not yet in a
            // dependency lock file - each variant is a fresh module dir.
            TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE: '1',
          },
        });
      } catch (error) {
        const failure = error as Error & {
          stdout?: string;
          stderr?: string;
          code?: string;
        };
        throw new Error(
          `terraform ${args.join(' ')} failed in ${cwd}:\n` +
            `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`.trim() +
            (failure.code === 'ETIMEDOUT' ? '\n(timed out)' : ''),
          { cause: error },
        );
      }
    };

    /**
     * Generate a workspace for the given options, materialize the shared
     * terraform sources, then run `terraform fmt -check`,
     * `terraform init -backend=false`, and `terraform validate` in the
     * rendered harness module directory. Never runs plan or apply.
     */
    const renderAndValidate = async (
      skip: (note?: string) => void,
      nameKebabCase: string,
      options: AgentcoreHarnessGeneratorSchema,
      mutateModule?: (module: string) => string,
    ): Promise<void> => {
      const tree = createTreeUsingTsSolutionSetup();
      await agentcoreHarnessGenerator(tree, options);

      const workDir = mkdtempSync(join(tmpdir(), 'agentcore-harness-tf-'));
      workDirs.push(workDir);
      materializeSharedTerraformSrc(tree, workDir);

      const moduleDir = join(workDir, 'src', 'app', 'harnesses', nameKebabCase);
      const modulePath = join(moduleDir, `${nameKebabCase}.tf`);
      if (mutateModule) {
        const module = tree.read(
          `${SHARED_TF_ROOT}src/app/harnesses/${nameKebabCase}/${nameKebabCase}.tf`,
          'utf-8',
        )!;
        writeFileSync(modulePath, mutateModule(module));
      }

      // Requirement 6.11: the module is in canonical format as generated
      // (and, for the advanced fixture, after extension-region edits).
      runTerraform(['fmt', '-check'], moduleDir);

      // Requirement 6.11: offline configuration validation. init only
      // installs the pinned providers and local modules; -backend=false
      // keeps state/backend out of the picture entirely.
      try {
        runTerraform(['init', '-backend=false', '-input=false'], moduleDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : `${error}`;
        if (NETWORK_FAILURE_PATTERN.test(message)) {
          skip(
            'terraform init could not download the pinned providers ' +
              '(offline environment?); terraform validate needs one ' +
              'registry download. Set TF_PLUGIN_CACHE_DIR to a warm cache ' +
              'or run with network access to execute this check.',
          );
          return;
        }
        throw error;
      }

      runTerraform(['validate'], moduleDir);
    };

    // Requirements 6.11, 14.2, 14.6: the default module is fmt-clean and
    // valid against the pinned provider schemas.
    it('defaults module passes terraform fmt -check and terraform validate', async (ctx) => {
      await renderAndValidate((note) => ctx.skip(note), 'my-harness', {
        name: 'my-harness',
        iac: 'terraform',
      });
    });

    // Requirements 3.1, 3.2, 6.11: custom creation values - including
    // HCL-hostile prompt text (quotes, newline, backslash, interpolation
    // and directive introducers) - render to fmt-clean, valid HCL.
    it('custom-options module passes terraform fmt -check and terraform validate', async (ctx) => {
      await renderAndValidate((note) => ctx.skip(note), 'custom-harness', {
        name: 'custom-harness',
        iac: 'terraform',
        modelId: 'us.anthropic.claude-sonnet-4-6',
        systemPrompt:
          'Line "one".\nUse ${interpolation} and %{directive} markers \\ safely.',
        allowedTools: ['@builtin', 'custom-tool_1'],
        maxIterations: 7,
        maxTokens: 2048,
        timeoutSeconds: 120,
      });
    });

    // Requirements 3.5, 6.11: the documented extension region accepts
    // provider-native advanced fields (attributes and blocks from the
    // pinned 6.54.0 schema) and the module still validates.
    it('advanced extension fixture in the extension region still validates', async (ctx) => {
      await renderAndValidate(
        (note) => ctx.skip(note),
        'advanced-harness',
        { name: 'advanced-harness', iac: 'terraform' },
        (module) => {
          // The fixture belongs in the documented extension region, right
          // where users are told to add provider-native configuration.
          expect(module).toContain('Advanced extension region');
          const anchor = '  depends_on = [aws_iam_role_policy.execution_role]';
          expect(module).toContain(anchor);

          // Provider-native advanced fields per the pinned 6.54.0 schema:
          // environment_variables and tags are attributes; custom JWT
          // authorization is the documented opt-in block that replaces the
          // default IAM inbound authorization.
          const fixture = [
            '  # Advanced extension fixture (test-only): provider-native',
            '  # fields added into the documented extension region.',
            '  environment_variables = {',
            '    LOG_LEVEL = "debug"',
            '  }',
            '',
            '  tags = {',
            '    project = "agentcore-harness-advanced-fixture"',
            '  }',
            '',
            '  authorizer_configuration {',
            '    custom_jwt_authorizer {',
            '      discovery_url = "https://example.com/.well-known/openid-configuration"',
            '    }',
            '  }',
            '',
          ].join('\n');
          return module.replace(anchor, `${fixture}${anchor}`);
        },
      );
    });
  },
);
