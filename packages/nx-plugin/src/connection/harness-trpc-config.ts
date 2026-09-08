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
  SHARED_TERRAFORM_DIR,
} from '../utils/shared-constructs-constants';
import { cdkLambdaRuntime, terraformLambdaRuntime } from '../utils/versions';

export interface HarnessTrpcConfigOptions {
  readonly apiNameKebabCase: string;
  readonly apiNameClassName: string;
  readonly harnessNameKebabCase: string;
  readonly harnessNameClassName: string;
  /** The API's `iac`. */
  readonly iac?: string;
  /**
   * The API's auth mode. Only read by the Terraform path — each Terraform
   * method resource declares its own authorization block, unlike CDK's
   * `defaultMethodOptions`, which every resource under `this.api.root`
   * (including '/agui') inherits automatically.
   */
  readonly auth?: string;
  /**
   * The API's tRPC integration pattern. Only read by the Terraform path,
   * whose existing-handler Memory-read grant differs in shape between a
   * single shared router Lambda and one Lambda per operation.
   */
  readonly integrationPattern?: 'isolated' | 'shared';
  /**
   * Workspace-root-relative directory holding the rolldown-bundled AG-UI
   * handler's `index.js`, produced by the API project's own `bundle` target.
   */
  readonly bundleOutputDir: string;
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
 * `POST /agui` on the API's own regional REST endpoint — inheriting the
 * API's authorizer, usage plan and CORS aspect (both apply automatically to
 * any resource added under `this.api.root`), and streaming via
 * `ResponseTransferMode.STREAM` the same way the API's own tRPC operations
 * already do. Also grants the API's existing tRPC handlers Memory-read
 * access, so an optional `history` procedure can reconstruct a conversation
 * from AgentCore Memory.
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
  // Terraform is wired by `addAguiRouteToTerraformApi`; an unresolved `iac`
  // (infra: 'none') has no generated infrastructure of either kind to patch.
  if (options.iac !== 'cdk') {
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

  await addDestructuredImport(
    tree,
    constructPath,
    ['EndpointType'],
    'aws-cdk-lib/aws-apigateway',
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
  const originExpression = esm
    ? 'import.meta.url'
    : "require('url').pathToFileURL(__filename).href";
  // Same depth (packages/common/constructs/src/app/apis/<name>.ts to the
  // workspace root) the base API construct already uses for its own handler's
  // bundle asset.
  const codeAssetExpression = `url.fileURLToPath(new URL('../../../../../../${options.bundleOutputDir}', ${originExpression}))`;

  const methodText = `
  /**
   * Adds an AG-UI streaming endpoint backed by ${options.harnessNameClassName},
   * translating its Converse-style stream into AG-UI server-sent events.
   * Only 'messages' and 'threadId' are read from the request; every other
   * Harness field (systemPrompt, model, tools, allowedTools, skills,
   * actorId) is pinned server-side by the generated handler.
   *
   * Streams over the API's own regional REST endpoint
   * (\`ResponseTransferMode.STREAM\`), which allows up to 5 minutes of idle
   * time and 15 minutes total per streamed response — an edge-optimized
   * endpoint's CloudFront layer caps idle time at 30s, which is why this
   * forces the API onto a regional endpoint below.
   */
  public addAguiRoute(harness: ${options.harnessNameClassName}): void {
    const rc = RuntimeConfig.ensure(this);
    const aguiHandler = new Function(this, 'AguiHandler', {
      runtime: ${cdkLambdaRuntime('node')},
      handler: 'index.handler',
      code: Code.fromAsset(${codeAssetExpression}),
      timeout: Duration.minutes(15),
      tracing: Tracing.ACTIVE,
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

  // Re-read the file: the `addDestructuredImport` calls above mutated it in
  // the tree (adding EndpointType, Grant and the Harness construct imports).
  // The original `source` snapshot predates those edits, so starting from it
  // here would discard the added imports when we write below.
  let updated = tree.read(constructPath, 'utf-8')!;

  // A regional endpoint is required for the '/agui' streamed response to get
  // the extended (5 min idle / 15 min total) timeout instead of the
  // edge-optimized default's CloudFront-imposed 30s idle cutoff. Defaulted
  // ahead of the spread `...props` below, so an app author can still override
  // it explicitly at the call site.
  const superAnchor = 'super(scope, id, {';
  const superIndex = updated.indexOf(superAnchor);
  if (superIndex >= 0) {
    const insertAt = superIndex + superAnchor.length;
    updated = `${updated.slice(0, insertAt)}\n      endpointConfiguration: { types: [EndpointType.REGIONAL] },${updated.slice(insertAt)}`;
  } else {
    logger.warn(
      `Could not find the '${options.apiNameClassName}' constructor's 'super(scope, id, {' call in ${constructPath}; add 'endpointConfiguration: { types: [EndpointType.REGIONAL] }' to it manually so '/agui' can stream past a 30s idle timeout.`,
    );
  }

  const lastBrace = updated.lastIndexOf('}');
  tree.write(
    constructPath,
    `${updated.slice(0, lastBrace)}${methodText}${updated.slice(lastBrace)}`,
  );
};

/**
 * Appends the `/agui` streaming route (Lambda + API Gateway resource,
 * method and integration) to the tRPC API's generated Terraform module.
 *
 * Terraform modules in this workspace don't reference each other directly
 * the way CDK constructs do — an app composes them by passing one module's
 * output as another's input — so this adds two new variables
 * (`agui_harness_arn`, `agui_harness_memory_arn`) for the caller to wire from
 * the connected Harness module's own `harness_arn` / `memory_arn` outputs:
 *
 * ```hcl
 * module "chat_api" {
 *   # ...
 *   agui_harness_arn        = module.my_harness.harness_arn
 *   agui_harness_memory_arn = module.my_harness.memory_arn
 * }
 * ```
 *
 * Idempotent: skips if `agui_harness_arn` is already declared in the file.
 */
export const addAguiRouteToTerraformApi = (
  tree: Tree,
  options: HarnessTrpcConfigOptions,
): void => {
  if (options.iac !== 'terraform') {
    return;
  }

  const modulePath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    'app',
    'apis',
    options.apiNameKebabCase,
    `${options.apiNameKebabCase}.tf`,
  );
  if (!tree.exists(modulePath)) {
    logger.warn(
      `Could not find the generated Terraform module for '${options.apiNameKebabCase}' at ${modulePath}; skipping AG-UI route wiring.`,
    );
    return;
  }

  const source = tree.read(modulePath, 'utf-8')!;
  if (source.includes('variable "agui_harness_arn"')) {
    return;
  }

  const harnessModulePath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    'app',
    'harnesses',
    options.harnessNameKebabCase,
    `${options.harnessNameKebabCase}.tf`,
  );
  if (!tree.exists(harnessModulePath)) {
    logger.warn(
      `Could not find a generated Terraform module for Harness '${options.harnessNameKebabCase}' at ${harnessModulePath} (it may have been generated with infra: 'none'); skipping AG-UI route wiring.`,
    );
    return;
  }

  const nodeRuntime = terraformLambdaRuntime('node');
  // Mirrors the same auth branch the base module's own `proxy_method` /
  // `operation_methods` resources use, since Terraform methods don't inherit
  // a "default" authorizer the way CDK's `defaultMethodOptions` do.
  const methodAuthText =
    options.auth === 'iam'
      ? `authorization = "AWS_IAM"`
      : options.auth === 'cognito'
        ? `authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito_authorizer.id
  # Accept access tokens from both sign-in flows: 'openid' (Cognito hosted UI)
  # and 'aws.cognito.signin.user.admin' (Cognito admin/SRP auth APIs).
  authorization_scopes = ["openid", "aws.cognito.signin.user.admin"]`
        : options.auth === 'custom'
          ? `authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.custom_authorizer.id`
          : `authorization = "NONE"`;
  // Grants the API's existing tRPC handler(s) Memory-read access, so an
  // optional `history` procedure can reconstruct a conversation from
  // AgentCore Memory. Shape differs by integration pattern: a single shared
  // router Lambda has one role, one per operation has a role per operation.
  const memoryReadText =
    options.integrationPattern === 'isolated'
      ? `
resource "aws_iam_role_policy" "agui_memory_read" {
  for_each = var.agui_harness_memory_arn != null ? local.operations : {}

  name = "\${substr(local.function_name[each.key], 0, 40)}-memory-read"
  role = aws_iam_role.lambda_execution_role[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock-agentcore:ListEvents", "bedrock-agentcore:GetEvent", "bedrock-agentcore:RetrieveMemoryRecords"]
      Resource = [var.agui_harness_memory_arn]
    }]
  })
}
`
      : `
resource "aws_iam_role_policy" "agui_memory_read" {
  count = var.agui_harness_memory_arn != null ? 1 : 0

  name = "${options.apiNameClassName}Handler-memory-read-\${random_string.suffix.result}"
  role = aws_iam_role.lambda_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock-agentcore:ListEvents", "bedrock-agentcore:GetEvent", "bedrock-agentcore:RetrieveMemoryRecords"]
      Resource = [var.agui_harness_memory_arn]
    }]
  })
}
`;
  const agui = `
# AG-UI streaming route, added by the agentcore-harness#trpc-connection
# generator. Wire agui_harness_arn (and, for the 'history' procedure,
# agui_harness_memory_arn) from the connected Harness module's outputs.
variable "agui_harness_arn" {
  description = "ARN of the connected AgentCore Harness (its module's harness_arn output)."
  type        = string
}

variable "agui_harness_memory_arn" {
  description = "ARN of the connected Harness's Memory resource (its module's memory_arn output), for the optional history procedure. Null skips granting Memory-read access."
  type        = string
  default     = null
}

resource "aws_iam_role" "agui_handler" {
  name = "${options.apiNameClassName}AguiHandler-role-\${random_string.suffix.result}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "agui_handler_basic_execution" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.agui_handler.name
}

resource "aws_iam_role_policy_attachment" "agui_handler_xray_execution" {
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
  role       = aws_iam_role.agui_handler.name
}

resource "aws_iam_role_policy" "agui_handler_policy" {
  name = "${options.apiNameClassName}AguiHandler-policy-\${random_string.suffix.result}"
  role = aws_iam_role.agui_handler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeHarness", "bedrock-agentcore:InvokeAgentRuntime"]
        Resource = [var.agui_harness_arn]
      }
    ], var.appconfig_application_arn != null ? [
      {
        Effect   = "Allow"
        Action   = ["appconfig:StartConfigurationSession", "appconfig:GetLatestConfiguration"]
        Resource = ["\${var.appconfig_application_arn}/*"]
      }
    ] : [])
  })
}

data "archive_file" "agui_handler_zip" {
  type        = "zip"
  source_dir  = "\${path.module}/../../../../../../../${options.bundleOutputDir}"
  output_path = "\${path.module}/../../../../../../../dist/packages/common/terraform/apis/${options.apiNameKebabCase}/agui.zip"
}

resource "aws_s3_object" "agui_handler_zip" {
  bucket      = var.asset_bucket_name
  key         = "apis/${options.apiNameKebabCase}/agui-\${data.archive_file.agui_handler_zip.output_sha256}.zip"
  source      = data.archive_file.agui_handler_zip.output_path
  source_hash = data.archive_file.agui_handler_zip.output_base64sha256
  etag        = data.archive_file.agui_handler_zip.output_md5
}

resource "aws_lambda_function" "agui_handler" {
  #checkov:skip=CKV_AWS_117:Lambda function is optionally deployed into a VPC via vpc_id/subnet_ids; not required for this use case
  #checkov:skip=CKV_AWS_116:Dead Letter Queue not required for this simple API use case
  #checkov:skip=CKV_AWS_272:Code signing not required for this use case
  #checkov:skip=CKV_AWS_115:Concurrent execution limit not required for this use case
  #checkov:skip=CKV_AWS_173:Lambda environment variables encrypted by managed key
  s3_bucket         = aws_s3_object.agui_handler_zip.bucket
  s3_key            = aws_s3_object.agui_handler_zip.key
  s3_object_version = aws_s3_object.agui_handler_zip.version_id
  function_name     = "${options.apiNameClassName}AguiHandler-\${random_string.suffix.result}"
  role              = aws_iam_role.agui_handler.arn
  handler           = "index.handler"
  runtime           = "${nodeRuntime}"
  timeout           = 900
  memory_size       = 256

  source_code_hash = data.archive_file.agui_handler_zip.output_base64sha256

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = var.appconfig_application_id != null ? {
      RUNTIME_CONFIG_APP_ID = var.appconfig_application_id
    } : {}
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "agui_handler_logs" {
  #checkov:skip=CKV_AWS_158:Using default CloudWatch log encryption
  #checkov:skip=CKV_AWS_338:Log retention set to forever
  #checkov:skip=CKV_AWS_66:Log retention set to forever
  name = "/aws/lambda/${options.apiNameClassName}AguiHandler-\${random_string.suffix.result}"
  tags = var.tags
}

resource "aws_api_gateway_resource" "agui" {
  rest_api_id = module.rest_api.api_id
  parent_id   = module.rest_api.api_root_resource_id
  path_part   = "agui"
}

resource "aws_api_gateway_method" "agui" {
  #checkov:skip=CKV2_AWS_53:Request validation not required for proxy integration as Lambda handles validation
  rest_api_id   = module.rest_api.api_id
  resource_id   = aws_api_gateway_resource.agui.id
  http_method   = "POST"
  ${methodAuthText}
}

resource "aws_api_gateway_integration" "agui" {
  rest_api_id = module.rest_api.api_id
  resource_id = aws_api_gateway_resource.agui.id
  http_method = aws_api_gateway_method.agui.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.agui_handler.response_streaming_invoke_arn
  response_transfer_mode  = "STREAM"

  depends_on = [aws_lambda_function.agui_handler]
}

resource "aws_lambda_permission" "agui_invoke" {
  statement_id  = "AllowExecutionFromAPIGatewayAgui"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agui_handler.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "\${module.rest_api.api_execution_arn}/*/POST/agui"

  depends_on = [module.rest_api, aws_lambda_function.agui_handler]
}
${memoryReadText}`;

  tree.write(modulePath, `${source}\n${agui}`);
};
