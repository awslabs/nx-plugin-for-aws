/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as posixPath from 'node:path/posix';
import { joinPathFragments, logger, type Tree } from '@nx/devkit';
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
  /**
   * The API's auth mode. Only 'iam' gets the streaming Lambda Function URL
   * (its SigV4 client model matches the Function URL's AWS_IAM auth); other
   * modes fall back to the API Gateway route.
   */
  readonly auth?: string;
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
  const isIam = options.auth === 'iam';
  if (isIam) {
    // The Function URL type + enums used by the injected `aguiFunctionUrl`
    // field and `addAguiRoute`. Kept out of the base API construct so a plain
    // tRPC API (no Harness) carries no AG-UI-specific members.
    await addDestructuredImport(
      tree,
      constructPath,
      ['FunctionUrl', 'FunctionUrlAuthType', 'HttpMethod', 'InvokeMode'],
      'aws-cdk-lib/aws-lambda',
    );
  }
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

  const endpointDoc = isIam
    ? `   *
   * The endpoint is a Lambda Function URL in RESPONSE_STREAM mode rather than
   * an API Gateway route: REST integrations cap a streamed response at the
   * endpoint's idle timeout (30s for edge-optimized), which truncates long
   * generations, whereas a Function URL streams for up to the Lambda timeout.`
    : '';

  const endpointText = isIam
    ? `
    // Stream over a Function URL in RESPONSE_STREAM mode. IAM auth matches the
    // API's SigV4 model: the browser signs with Cognito Identity Pool
    // credentials (aws4fetch resolves the service to 'lambda' from the
    // *.lambda-url.*.on.aws host). CORS is configured on the Function URL so
    // the unsigned browser preflight is answered without invoking the function.
    this.aguiFunctionUrl = aguiHandler.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: [...this.allowedOrigins],
        allowedMethods: [HttpMethod.POST],
        allowedHeaders: [
          'authorization',
          'content-type',
          'x-amz-date',
          'x-amz-content-sha256',
          'x-amz-security-token',
        ],
        maxAge: Duration.days(1),
      },
    });
    rc.set('connection', 'apis', {
      ...rc.get('connection').apis,
      Agui: this.aguiFunctionUrl.url,
    });`
    : `
    const aguiResource = this.api.root.addResource('agui');
    aguiResource.addMethod(
      'POST',
      new LambdaIntegration(aguiHandler, {
        responseTransferMode: ResponseTransferMode.STREAM,
      }),
    );`;

  const methodText = `
  /**
   * Adds an AG-UI streaming endpoint backed by ${options.harnessNameClassName},
   * translating its Converse-style stream into AG-UI server-sent events.
   * Only 'messages' and 'threadId' are read from the request; every other
   * Harness field (systemPrompt, model, tools, allowedTools, skills,
   * actorId) is pinned server-side by the generated handler.
${endpointDoc}
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
${endpointText}

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

  // For IAM auth the '/agui' endpoint is a Lambda Function URL. Its handle is
  // stored on a class field so `grantInvokeAccess` can grant the caller invoke
  // access alongside the REST API. The field lives here (injected with the
  // method) rather than in the base API construct template, so a plain tRPC
  // API that never connects a Harness carries no AG-UI-specific members.
  const fieldText = isIam
    ? `
  /**
   * The Lambda Function URL that streams AG-UI events, set by \`addAguiRoute\`.
   */
  public aguiFunctionUrl?: FunctionUrl;
`
    : '';

  let updated = tree.read(constructPath, 'utf-8')!;

  // Grant the Function URL's invoke permission wherever the API grants its own
  // invoke access, so the same principal (e.g. the website's authenticated
  // identity) can call both. Anchored on `arnForExecuteApi` — unique to the
  // IAM `grantInvokeAccess` method and independent of the workspace's quote
  // style — inserting the grant right after that statement's `});`.
  if (isIam) {
    const anchor = 'arnForExecuteApi';
    const anchorIndex = updated.indexOf(anchor);
    if (anchorIndex >= 0) {
      const closeIndex = updated.indexOf('});', anchorIndex);
      if (closeIndex >= 0) {
        const insertAt = closeIndex + '});'.length;
        updated = `${updated.slice(0, insertAt)}\n\n    // The AG-UI stream is a Lambda Function URL (AWS_IAM), so it needs its own\n    // invoke grant alongside the REST API's.\n    this.aguiFunctionUrl?.grantInvokeUrl(grantee);${updated.slice(insertAt)}`;
      } else {
        logger.warn(
          `Could not locate the end of 'grantInvokeAccess' in ${constructPath}; add 'this.aguiFunctionUrl?.grantInvokeUrl(grantee);' to it manually so the '/agui' Function URL is invokable.`,
        );
      }
    } else {
      logger.warn(
        `Could not find a 'grantInvokeAccess' method in ${constructPath}; add 'this.aguiFunctionUrl?.grantInvokeUrl(grantee);' to your invoke grant manually so the '/agui' Function URL is invokable.`,
      );
    }
  }

  const lastBrace = updated.lastIndexOf('}');
  tree.write(
    constructPath,
    `${updated.slice(0, lastBrace)}${fieldText}${methodText}${updated.slice(lastBrace)}`,
  );
};
