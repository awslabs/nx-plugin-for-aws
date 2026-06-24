/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CloudFormation, StackStatus } from '@aws-sdk/client-cloudformation';
import { ensureDirSync } from 'fs-extra';
import { runCLI, tmpProjPath } from '../utils';
import {
  invokeAgentCoreA2a,
  invokeAgentCoreAgent,
  invokeAgentCoreAgUi,
  invokeAgentCoreGatewayTool,
  invokeAgentCoreMcp,
  invokeCustomAuthApi,
  invokeCustomAuthTrpcApi,
  invokeLambda,
  invokeRestApi,
  invokeTrpcAgentCoreAgent,
  invokeTrpcApi,
  pingWebsite,
} from './deploy-invocations';
import { ensureRdsServiceLinkedRole } from './deploy-prerequisites';
import { runSmokeTest } from './smoke-test';

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
 * cdk-deploy smoke test — deploys the non-RDB application stack (APIs,
 * agents, MCP servers, Lambda functions, website), exercises every
 * invocation surface, and tears down.
 *
 * The relational database constructs (`PostgresDb`, `MySqlDb`) are
 * exercised by the separate `cdk-deploy-rdb` variant — Aurora cluster
 * create + destroy plus VPC ENI cleanup for the rotation Lambdas
 * dominate the runtime, so isolating them keeps both variants under the
 * IAM session limit.
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

      // Custom auth APIs — should deny unauthenticated requests
      await invokeCustomAuthTrpcApi(
        findOutput('MyApiCustomApiEndpoint'),
        'tRPC REST Custom Auth',
      );
      await invokeCustomAuthTrpcApi(
        findOutput('MyApiCustomHttpMyApiCustomHttpUrl'),
        'tRPC HTTP Custom Auth',
      );
      await invokeCustomAuthApi(
        findOutput('PyApiCustomApiEndpoint'),
        'FastAPI REST Custom Auth',
      );
      await invokeCustomAuthApi(
        findOutput('PyApiCustomHttpPyApiCustomHttpUrl'),
        'FastAPI HTTP Custom Auth',
      );

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
      await invokeAgentCoreAgent(findOutput('PyAgentArn'), 'Python Agent');
      await invokeTrpcAgentCoreAgent(
        findOutput('TsAgentArn'),
        'TypeScript Agent',
      );
      // Python LangChain (AG-UI) agent — POST a RunAgentInput to /invocations
      // and assert a streamed AG-UI response (no RUN_ERROR). Proves a deployed
      // langchain agent runtime boots and serves over the AG-UI protocol.
      await invokeAgentCoreAgUi(
        findOutput('PyLangchainAgentArn'),
        'Python LangChain Agent',
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
        findOutput('TsAgentArn'),
        'TS Agent -> TS A2A (via askMyTsA2aAgent)',
        'Use the askMyTsA2aAgent tool to ask the remote agent what 5 * 4 is. Return just the answer.',
      );
      await invokeTrpcAgentCoreAgent(
        findOutput('TsAgentArn'),
        'TS Agent -> PY A2A (via askMyPyA2aAgent)',
        'Use the askMyPyA2aAgent tool to ask the remote agent what 11 + 2 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        findOutput('PyAgentArn'),
        'PY Agent -> TS A2A (via ask_my_ts_a2a_agent)',
        'Use the ask_my_ts_a2a_agent tool to ask the remote agent what 9 - 3 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        findOutput('PyAgentArn'),
        'PY Agent -> PY A2A (via ask_my_py_a2a_agent)',
        'Use the ask_my_py_a2a_agent tool to ask the remote agent what 7 + 8 is. Return just the answer.',
      );

      // AgentCore Gateway — both HTTP agents have the gateway's tools wired in
      // via the gateway-connection generators, and the gateway fronts both the
      // TypeScript (`hosted-mcp-server`) and Python (`my-mcp-server`) MCP
      // servers. Prompt each agent to call a gateway-prefixed tool
      // (`<target>___<tool>`) for each upstream server and assert the result.
      // A successful round-trip proves agent -> deployed Gateway (Cedar
      // ENFORCE + SigV4) -> MCP server works end-to-end for both languages.
      expect(
        await invokeTrpcAgentCoreAgent(
          findOutput('TsAgentArn'),
          'TS Agent -> Gateway -> TS MCP (hosted-mcp-server___divide)',
          'Use the hosted-mcp-server___divide tool to divide 6 by 2. Return just the number.',
        ),
      ).toContain('3');
      expect(
        await invokeTrpcAgentCoreAgent(
          findOutput('TsAgentArn'),
          'TS Agent -> Gateway -> PY MCP (my-mcp-server___add)',
          'Use the my-mcp-server___add tool to add 6 and 2. Return just the number.',
        ),
      ).toContain('8');
      expect(
        await invokeAgentCoreAgent(
          findOutput('PyAgentArn'),
          'PY Agent -> Gateway -> TS MCP (hosted-mcp-server___divide)',
          'Use the hosted-mcp-server___divide tool to divide 6 by 2. Return just the number.',
        ),
      ).toContain('3');
      expect(
        await invokeAgentCoreAgent(
          findOutput('PyAgentArn'),
          'PY Agent -> Gateway -> PY MCP (my-mcp-server___add)',
          'Use the my-mcp-server___add tool to add 6 and 2. Return just the number.',
        ),
      ).toContain('8');

      // Chained gateways — the parent gateway fronts MyGateway via the
      // gateway -> gateway connection, re-exposing its tools under a second
      // prefix. Listing tools on the parent and calling one proves the
      // parent -> MyGateway (SigV4 + Cedar at both hops) -> MCP server chain
      // works end-to-end.
      await invokeAgentCoreGatewayTool(
        findOutput('ParentGatewayUrl'),
        'Parent Gateway -> Gateway -> TS MCP',
        'my-gateway___hosted-mcp-server___divide',
        { a: 6, b: 2 },
        '3',
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

/**
 * cdk-deploy-rdb smoke test — deploys only the relational database stack
 * (PostgreSQL + MySQL Aurora clusters with a dedicated VPC). The full
 * generator matrix is still scaffolded and built so the rdb generator's
 * coexistence with the rest of the matrix is verified, but only the
 * database constructs are deployed to AWS.
 */
describe('smoke test - cdk-deploy-rdb', () => {
  const pkgMgr = 'npm';
  const targetDir = `${tmpProjPath()}/cdk-deploy-rdb-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    const { opts } = await runSmokeTest(targetDir, pkgMgr);

    const testRunId = Math.random().toString(36).substring(2, 10);

    // Swap in the rdb-only application stack — same workspace, smaller
    // deploy surface. Deletion-aspects in main.ts.template still apply.
    const rdbStackContent = readFileSync(
      join(__dirname, '../files/application-stack-rdb.ts.template'),
      'utf-8',
    );
    writeFileSync(
      `${opts.cwd}/packages/infra/src/stacks/application-stack.ts`,
      rdbStackContent,
    );

    const templateContent = readFileSync(
      join(__dirname, '../files/cdk-deploy/main.ts.template'),
      'utf-8',
    );
    const mainContent = templateContent.replace(
      /<% TEST_RUN_ID %>/g,
      testRunId,
    );
    writeFileSync(`${opts.cwd}/packages/infra/src/main.ts`, mainContent);

    // Stage name is set by main.ts.template (`e2e-test-infra-sandbox-…`).
    const cdkStageName = `e2e-test-infra-sandbox-${testRunId}`;

    ensureRdsServiceLinkedRole();

    try {
      await runCLI(
        `deploy infra ${cdkStageName}/* --output-style=stream`,
        opts,
      );
    } finally {
      try {
        await runCLI(
          `destroy infra ${cdkStageName}/* --output-style=stream --force`,
          opts,
        );
      } catch (e) {
        console.warn(`cdk destroy failed (will still clean up): ${e}`);
      }
      await deleteLeftoverStacks(cdkStageName);
    }
  });
});
