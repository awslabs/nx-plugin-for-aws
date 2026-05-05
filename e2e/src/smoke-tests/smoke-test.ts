/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PackageManager } from '@nx/devkit';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { join } from 'path';
import { afterEach, beforeEach, describe, it } from 'vitest';

export const runSmokeTest = async (
  dir: string,
  pkgMgr: string,
  onProjectCreate?: (projectRoot: string) => void,
) => {
  let cnwError: unknown;
  try {
    await runCLI(
      `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test', 'CDK')} --interactive=false --skipGit`,
      {
        cwd: dir,
        prefixWithPackageManagerCmd: false,
        redirectStderr: true,
      },
    );
  } catch (e) {
    cnwError = e;
  }
  const projectRoot = `${dir}/e2e-test`;
  if (pkgMgr === 'pnpm') {
    const pluginDir = `${projectRoot}/node_modules/@aws/nx-plugin`;
    console.log('=== @aws/nx-plugin install state ===');
    console.log('projectRoot exists:', existsSync(projectRoot));
    console.log('pluginDir exists:', existsSync(pluginDir));
    if (existsSync(pluginDir)) {
      console.log(
        'pluginDir contents (depth 1):',
        require('fs').readdirSync(pluginDir).sort().join(' '),
      );
      const pkg = `${pluginDir}/package.json`;
      if (existsSync(pkg)) {
        const pkgContent = readFileSync(pkg, 'utf-8');
        console.log('package.json first 200 chars:', pkgContent.slice(0, 200));
      }
      const gen = `${pluginDir}/generators.json`;
      console.log('generators.json exists:', existsSync(gen));
      if (existsSync(gen)) {
        const content = readFileSync(gen, 'utf-8');
        console.log('generators.json size:', content.length);
        console.log('generators.json first 300 chars:', content.slice(0, 300));
      }
    }
    console.log('=== end ===');
  }
  if (cnwError) throw cnwError;
  const opts = {
    cwd: projectRoot,
    env: {
      NX_DAEMON: 'false',
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
  };
  if (onProjectCreate) {
    onProjectCreate(projectRoot);
  }
  await runCLI(
    `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#infra --name=infra-with-stages --enableStageConfig=true --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website --name=website --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website --name=website-no-router --enableTanstackRouter=false --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#astro-docs --name=docs-site --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#trpc-api --name=my-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#trpc-api --name=my-api-http --computeType=ServerlessApiGatewayHttpApi --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website#auth --project=@e2e-test/website --cognitoDomain=test --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website#auth --project=@e2e-test/website-no-router --cognitoDomain=test-no-router --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=@e2e-test/my-api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website-no-router --targetProject=@e2e-test/my-api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#fast-api --name=py-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#fast-api --name=py-api-http --computeType=ServerlessApiGatewayHttpApi --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --functionName=my-function --eventSource=Any --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#mcp-server --project=py_project --name=my-mcp-server --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-agent --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --functionName=my-function --eventSource=Any --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp-server --computeType=None --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=hosted-mcp-server --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-agent --computeType=None --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  // Generate A2A protocol agents for both TypeScript and Python.
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-a2a-agent --protocol=A2A --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-a2a-agent --protocol=A2A --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  // Cognito-auth variants to cover the A2A + Cognito permutation for schema/build coverage.
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-a2a-agent-cognito --protocol=A2A --auth=Cognito --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-a2a-agent-cognito --protocol=A2A --auth=Cognito --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  // Generate AG-UI protocol agent (Python only - TypeScript AG-UI is not yet supported)
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-agui-agent --protocol=AG-UI --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=py_api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#smithy-api --name=my-smithy-api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=my-smithy-api --no-interactive`,
    opts,
  );

  // Connect the TS strands agent to both TS and Python MCP servers
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=py_project --targetComponent=my-mcp-server --no-interactive`,
    opts,
  );

  // Connect the Python strands agent to the Python MCP server
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=py_project --targetComponent=my-mcp-server --no-interactive`,
    opts,
  );

  // Connect each HTTP strands agent to each A2A strands agent (4 permutations)
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=ts-project --targetComponent=my-ts-a2a-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=py_project --targetComponent=my-py-a2a-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=ts-project --targetComponent=my-ts-a2a-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=py_project --targetComponent=my-py-a2a-agent --no-interactive`,
    opts,
  );

  // Connect the React website to the TS strands agent
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=ts-project --targetComponent=agent --no-interactive`,
    opts,
  );

  // Connect the React website to the Python strands agent
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_project --targetComponent=my-agent --no-interactive`,
    opts,
  );

  // Connect the React website to the Python AG-UI strands agent (CopilotKit)
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_project --targetComponent=my-py-agui-agent --no-interactive`,
    opts,
  );

  await runCLI(`generate @aws/nx-plugin:license --no-interactive`, opts);

  await runCLI(
    `generate @aws/nx-plugin:ts#nx-plugin --name=plugin --directory=tools --no-interactive`,
    opts,
  );

  await runCLI(
    `generate @aws/nx-plugin:ts#nx-generator --project=@e2e-test/plugin --name=my#generator --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @e2e-test/plugin:my#generator --exampleOption=test --no-interactive`,
    opts,
  );

  await runCLI(
    `generate @aws/nx-plugin:terraform#project --name=tf-infra --no-interactive`,
    opts,
  );

  // Wire up website, cognito and trpc api
  writeFileSync(
    `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
    readFileSync(
      join(__dirname, '../files/application-stack.ts.template'),
      'utf-8',
    ),
  );

  // Since the smoke tests don't run in a git repo, we need to exclude some patterns for the license sync
  writeFileSync(
    `${opts.cwd}/aws-nx-plugin.config.mts`,
    readFileSync(
      join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
      'utf-8',
    ),
  );

  await runCLI(`sync --verbose`, opts);
  await runCLI(
    `run-many --target build --all --output-style=stream --skip-nx-cache --verbose`,
    opts,
  );

  return { opts };
};

export interface SmokeTestOptions {
  /**
   * Label used in the describe block (defaults to `pkgMgr`). Allows separate
   * variants of the same package manager — e.g. "yarn" for classic and
   * "yarn-4" for berry — to be targeted individually from the CI matrix.
   */
  variant?: string;
  /**
   * Optional per-variant setup. Runs inside `beforeEach` so each test gets a
   * clean environment (e.g. activating yarn 4 via corepack). Returning a
   * teardown function registers it for `afterEach`.
   */
  setup?: () => void | (() => void);
  onProjectCreate?: (projectRoot: string) => void;
}

export const smokeTest = (
  pkgMgr: PackageManager,
  options: SmokeTestOptions = {},
) => {
  const variant = options.variant ?? pkgMgr;
  describe(`smoke test - ${variant}`, () => {
    let teardown: (() => void) | void;
    beforeEach(() => {
      teardown = options.setup?.();
      const targetDir = `${tmpProjPath()}/${variant}`;
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
      // Pin the @aws scope to verdaccio locally in the target dir so
      // `pnpm create @aws/nx-workspace` (via `pnpm dlx`) resolves the
      // 0.0.0 build we just published instead of falling through to the
      // public registry's `latest` tag. The user-level npmrc set up in
      // global-setup.ts is honoured by pnpm 10 but not always by pnpm 11's
      // dlx when `npm_config_registry` is also set in the environment.
      const localRegistry = process.env.NX_E2E_LOCAL_REGISTRY;
      if (localRegistry) {
        writeFileSync(
          join(targetDir, '.npmrc'),
          [
            `@aws:registry=${localRegistry}`,
            `//${localRegistry.replace(/^https?:\/\//, '').replace(/\/$/, '')}/:_authToken=secretVerdaccioToken`,
            '',
          ].join('\n'),
          { encoding: 'utf-8' },
        );
      }
    });
    afterEach(() => {
      teardown?.();
      teardown = undefined;
    });

    it(`Should generate and build - ${variant}`, async () => {
      await runSmokeTest(
        `${tmpProjPath()}/${variant}`,
        pkgMgr,
        options.onProjectCreate,
      );
    });
  });
};
