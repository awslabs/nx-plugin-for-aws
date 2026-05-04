/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { runCLI, tmpProjPath } from '../utils';
import { join } from 'path';
import { CloudFormation, StackStatus } from '@aws-sdk/client-cloudformation';
import { runSmokeTest } from './smoke-test';
import {
  invokeAgentCoreA2a,
  invokeAgentCoreAgent,
  invokeAgentCoreMcp,
  invokeLambda,
  invokeRestApi,
  invokeTrpcAgentCoreAgent,
  invokeTrpcApi,
  pingWebsite,
} from './deploy-invocations';

/**
 * Delete any CloudFormation stacks matching the test run prefix that were
 * not cleaned up by cdk destroy.
 *
 * The Website construct creates a cross-region WAF WebACL stack in us-east-1.
 * When the Application stack deploy fails, cdk destroy only tears down the
 * Application stack and skips the WAF stack, leaving orphaned WebACLs that
 * accumulate towards the NUM_WEBACLS_BY_ACCOUNT limit.
 */
async function deleteLeftoverStacks(cdkStageName: string): Promise<void> {
  const regions = [process.env.AWS_REGION || 'us-west-2', 'us-east-1'];
  const uniqueRegions = [...new Set(regions)];

  for (const region of uniqueRegions) {
    const cfn = new CloudFormation({ region });
    try {
      const stacks = await cfn.listStacks({
        StackStatusFilter: [
          StackStatus.CREATE_COMPLETE,
          StackStatus.UPDATE_COMPLETE,
          StackStatus.ROLLBACK_COMPLETE,
        ],
      });
      const leftoverStacks = (stacks.StackSummaries ?? []).filter((s) =>
        s.StackName?.startsWith(cdkStageName),
      );
      for (const stack of leftoverStacks) {
        console.log(
          `Deleting leftover stack ${stack.StackName} (${stack.StackStatus}) in ${region}`,
        );
        await cfn
          .deleteStack({ StackName: stack.StackName })
          .catch((e) =>
            console.warn(`Failed to delete stack ${stack.StackName}: ${e}`),
          );
      }
    } catch (e) {
      console.warn(`Failed to list stacks in ${region}: ${e}`);
    }
  }
}

/**
 * A test which deploys the smoke test resources to aws
 */
describe('smoke test - cdk-deploy', () => {
  const pkgMgr = 'npm';
  const targetDir = `${tmpProjPath()}/cdk-deploy-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    const { opts } = await runSmokeTest(targetDir, pkgMgr);

    // Generate an 8 digit alphanumeric random testRunId
    const testRunId = Math.random().toString(36).substring(2, 10);

    // Copy our updated cdk app which ensures resources are all deleted on destroy and stack names don't clash
    const templateContent = readFileSync(
      join(__dirname, '../files/cdk-deploy/main.ts.template'),
      'utf-8',
    );
    const mainContent = templateContent.replace(
      /<% TEST_RUN_ID %>/g,
      testRunId,
    );
    writeFileSync(`${opts.cwd}/packages/infra/src/main.ts`, mainContent);

    const cdkStageName = `e2e-test-infra-sandbox-${testRunId}`;

    try {
      // Deploy the e2e test resources
      await runCLI(
        `deploy infra ${cdkStageName}/* --output-style=stream`,
        opts,
      );

      const cfn = new CloudFormation();

      const outputs =
        (
          await cfn.describeStacks({
            StackName: `${cdkStageName}-Application`,
          })
        ).Stacks?.[0]?.Outputs ?? [];

      // Helper function to find cloudformation output value by key prefix
      const findOutput = (keyPrefix: string): string => {
        const output = outputs.find((o) => o.OutputKey?.startsWith(keyPrefix));
        if (!output?.OutputValue) {
          throw new Error(`Output with key prefix ${keyPrefix} not found`);
        }
        return output.OutputValue;
      };

      // tRPC
      await invokeTrpcApi(findOutput('MyApiEndpoint'), 'tRPC REST API');
      await invokeTrpcApi(findOutput('MyApiHttpMyApiHttpUrl'), 'tRPC HTTP API');

      // FastAPI
      await invokeRestApi(findOutput('PyApiEndpoint'), 'FastAPI REST');
      await invokeRestApi(findOutput('PyApiHttpPyApiHttpUrl'), 'FastAPI HTTP');

      // Smithy
      await invokeRestApi(findOutput('MySmithyApiEndpoint'), 'Smithy REST');

      // MCP
      await invokeAgentCoreMcp(
        findOutput('TsMcpServerArn'),
        'TypeScript MCP Server',
      );
      await invokeAgentCoreMcp(
        findOutput('PyMcpServerArn'),
        'Python MCP Server',
      );

      // Agent
      await invokeAgentCoreAgent(
        findOutput('StrandsAgentArn'),
        'Strands Agent',
      );
      await invokeTrpcAgentCoreAgent(
        findOutput('TsStrandsAgentArn'),
        'TypeScript Strands Agent',
      );

      // A2A agents — invoke via the A2A JSON-RPC message/send method over
      // SigV4 against the AgentCore runtime URL.
      await invokeAgentCoreA2a(
        findOutput('TsA2aAgentArn'),
        'TypeScript A2A Agent',
      );
      await invokeAgentCoreA2a(findOutput('PyA2aAgentArn'), 'Python A2A Agent');

      // A2A connection generators — the HTTP host agents have vended A2A
      // clients for each A2A target, and the Agent tools array has the
      // generated delegate tools. Prompt the host to invoke each delegate
      // and assert it succeeds (proving the a2a-connection code path works
      // end-to-end on AgentCore with SigV4 between two deployed agents).
      // Tool names follow the generator's convention: `ask<TargetClassName>`
      // for TS, `ask_<target_snake_case>` for Python.
      await invokeTrpcAgentCoreAgent(
        findOutput('TsStrandsAgentArn'),
        'TS Agent -> TS A2A (via askMyTsA2aAgent)',
        'Use the askMyTsA2aAgent tool to ask the remote agent what 5 * 4 is. Return just the answer.',
      );
      await invokeTrpcAgentCoreAgent(
        findOutput('TsStrandsAgentArn'),
        'TS Agent -> PY A2A (via askMyPyA2aAgent)',
        'Use the askMyPyA2aAgent tool to ask the remote agent what 11 + 2 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        findOutput('StrandsAgentArn'),
        'PY Agent -> TS A2A (via ask_my_ts_a2a_agent)',
        'Use the ask_my_ts_a2a_agent tool to ask the remote agent what 9 - 3 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        findOutput('StrandsAgentArn'),
        'PY Agent -> PY A2A (via ask_my_py_a2a_agent)',
        'Use the ask_my_py_a2a_agent tool to ask the remote agent what 7 + 8 is. Return just the answer.',
      );

      // Lambda functions
      await invokeLambda(findOutput('PyFunctionArn'), 'Python Function');
      await invokeLambda(findOutput('TsFunctionArn'), 'TypeScript Function');

      // Website
      await pingWebsite(findOutput('WebsiteDistributionDomainName'));
    } finally {
      try {
        await runCLI(
          `destroy infra ${cdkStageName}/* --output-style=stream --force`,
          opts,
        );
      } catch (e) {
        console.warn(`cdk destroy failed (will still clean up): ${e}`);
      }
      // cdk destroy skips cross-region stacks (e.g. WAF in us-east-1) when
      // the main stack is in ROLLBACK_COMPLETE. Clean up any leftovers.
      await deleteLeftoverStacks(cdkStageName);
    }
  });
});
