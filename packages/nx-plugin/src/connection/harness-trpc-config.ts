/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, logger, type Tree } from '@nx/devkit';
import * as posixPath from 'node:path/posix';
import { addDestructuredImport } from '../utils/ast';
import { isEsmWorkspace } from '../utils/module-format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../utils/shared-constructs-constants';

export interface HarnessTrpcConfigOptions {
  /** The tRPC API project's root, e.g. 'packages/chat-api'. */
  readonly apiProjectRoot: string;
  readonly apiNameKebabCase: string;
  readonly apiNameClassName: string;
  readonly harnessNameKebabCase: string;
  readonly harnessNameClassName: string;
  /** The API's `iac`; only 'cdk' is wired by this generator today. */
  readonly iac?: string;
}

const relativeModuleSpecifier = (fromFile: string, toFile: string): string => {
  const rel = posixPath
    .relative(posixPath.dirname(fromFile), toFile)
    .replace(/\.ts$/, '.js');
  return rel.startsWith('.') ? rel : `./${rel}`;
};

/**
 * Adds an `addAguiRoute` method to the tRPC API's generated CDK construct,
 * wiring a dedicated streaming Lambda that translates the connected
 * Harness's Converse-style stream into AG-UI SSE and exposes it as
 * `POST /agui` — inheriting the API's own authorizer and CORS aspect (both
 * apply automatically to any resource added under `this.api.root`, per
 * `AddCorsPreflightAspect` and `defaultMethodOptions`). Also grants the
 * API's existing tRPC handlers Memory-read access and the `HARNESS_ARN` /
 * `MEMORY_ARN` env vars, so an optional `history` procedure can reconstruct
 * a conversation from AgentCore Memory.
 *
 * The generated method is not called automatically — every construct in a
 * generated app is hand-assembled in the application stack, and the Harness
 * this route depends on is no exception. Callers add one line:
 * `<apiVar>.addAguiRoute(<harnessVar>);`.
 *
 * Idempotent: skips if `addAguiRoute` is already present in the file.
 */
export const addAguiRouteToApi = async (
  tree: Tree,
  options: HarnessTrpcConfigOptions,
): Promise<void> => {
  if (options.iac !== 'cdk') {
    logger.warn(
      `agentcore-harness#trpc-connection does not yet wire the /agui route into ${options.iac ?? 'this'} infrastructure for '${options.apiNameKebabCase}'. The AG-UI application code was still generated under src/agui — wire the Lambda, API Gateway route and Harness invoke grant manually.`,
    );
    return;
  }

  const constructPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'app',
    'apis',
    `${options.apiNameKebabCase}.ts`,
  );
  if (!tree.exists(constructPath)) {
    logger.warn(
      `Could not find the generated CDK construct for '${options.apiNameKebabCase}' at ${constructPath}; skipping AG-UI route wiring.`,
    );
    return;
  }

  const source = tree.read(constructPath, 'utf-8')!;
  if (source.includes('addAguiRoute(')) {
    return;
  }

  const harnessConstructPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'app',
    'harnesses',
    options.harnessNameKebabCase,
    `${options.harnessNameKebabCase}.ts`,
  );
  if (!tree.exists(harnessConstructPath)) {
    logger.warn(
      `Could not find a generated CDK construct for Harness '${options.harnessNameKebabCase}' at ${harnessConstructPath} (it may have been generated with infra: 'none'); skipping AG-UI route wiring.`,
    );
    return;
  }
  const handlerEntryPath = joinPathFragments(
    options.apiProjectRoot,
    'src',
    'agui',
    'handler.ts',
  );

  await addDestructuredImport(
    tree,
    constructPath,
    ['NodejsFunction', 'OutputFormat'],
    'aws-cdk-lib/aws-lambda-nodejs',
  );
  await addDestructuredImport(
    tree,
    constructPath,
    ['Grant'],
    'aws-cdk-lib/aws-iam',
  );
  await addDestructuredImport(
    tree,
    constructPath,
    [options.harnessNameClassName],
    relativeModuleSpecifier(constructPath, harnessConstructPath),
  );

  const esm = isEsmWorkspace(tree);
  const entrySpecifier = relativeModuleSpecifier(
    constructPath,
    handlerEntryPath,
  ).replace(/\.js$/, '');
  let entryExpression: string;
  if (esm) {
    entryExpression = `url.fileURLToPath(new URL('${entrySpecifier}.ts', import.meta.url))`;
  } else {
    entryExpression = `path.join(__dirname, '${entrySpecifier}.ts')`;
    const withPath = tree.read(constructPath, 'utf-8')!;
    if (!/from ['"]path['"]/.test(withPath)) {
      tree.write(constructPath, `import * as path from 'path';\n${withPath}`);
    }
  }

  const methodText = `
  /**
   * Adds a POST /agui route backed by ${options.harnessNameClassName},
   * translating its Converse-style stream into AG-UI server-sent events.
   * Only 'messages' and 'threadId' are read from the request; every other
   * Harness field (systemPrompt, model, tools, allowedTools, skills,
   * actorId) is pinned server-side by the generated handler.
   */
  public addAguiRoute(harness: ${options.harnessNameClassName}): void {
    const rc = RuntimeConfig.ensure(this);
    const aguiHandler = new NodejsFunction(this, 'AguiHandler', {
      entry: ${entryExpression},
      runtime: Runtime.NODEJS_LATEST,
      timeout: Duration.seconds(180),
      tracing: Tracing.ACTIVE,
      bundling: {
        format: OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire as __aguiCreateRequire } from 'module'; const require = __aguiCreateRequire(import.meta.url);",
      },
      environment: {
        HARNESS_ARN: harness.harnessArn,
        MEMORY_ARN: harness.harness.attrMemoryManagedMemoryConfigurationArn,
      },
    });
    aguiHandler.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      rc.appConfigApplicationId,
    );
    rc.grantReadAppConfig(aguiHandler);
    harness.grantInvokeAccess(aguiHandler);

    const aguiResource = this.api.root.addResource('agui');
    aguiResource.addMethod(
      'POST',
      new LambdaIntegration(aguiHandler, {
        responseTransferMode: ResponseTransferMode.STREAM,
      }),
    );

    // Grants every existing tRPC operation handler Memory-read access, so an
    // optional 'history' procedure can reconstruct a conversation from
    // AgentCore Memory, decoupled from the '/agui' connection's lifetime.
    Object.values(this.integrations).forEach((integration) => {
      if ('handler' in integration && integration.handler instanceof Function) {
        integration.handler.addEnvironment('HARNESS_ARN', harness.harnessArn);
        integration.handler.addEnvironment(
          'MEMORY_ARN',
          harness.harness.attrMemoryManagedMemoryConfigurationArn,
        );
        Grant.addToPrincipal({
          grantee: integration.handler,
          actions: [
            'bedrock-agentcore:ListEvents',
            'bedrock-agentcore:GetEvent',
            'bedrock-agentcore:RetrieveMemoryRecords',
          ],
          resourceArns: [
            harness.harness.attrMemoryManagedMemoryConfigurationArn,
          ],
        });
      }
    });
  }
`;

  const updated = tree.read(constructPath, 'utf-8')!;
  const lastBrace = updated.lastIndexOf('}');
  tree.write(
    constructPath,
    `${updated.slice(0, lastBrace)}${methodText}${updated.slice(lastBrace)}`,
  );
};
