/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import {
  addDestructuredImport,
  applyGritQL,
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Publish an API's custom domain, when one is configured, as its URL in runtime
 * config, so clients call it rather than the generated execute-api endpoint.
 *
 * - The vended CDK `RestApi` publishes `https://<domainName>/[<basePath>/]` when
 *   `domainName` is set.
 * - The vended CDK `HttpApi` forwards `defaultDomainMapping` to the stage it
 *   creates (previously rejected by CDK, since the construct disables the
 *   default stage) and publishes the mapping's domain URL.
 * - Each vended Terraform API app module (`app/apis/<name>/<name>.tf`) gains
 *   `custom_domain_name` / `acm_certificate_arn` variables, the domain and
 *   mapping resources, an `api_url` local published in runtime config, and
 *   outputs for the URL and DNS record targets.
 *
 * These files are generated with `KeepExisting`, so an upgraded workspace keeps
 * the old shape until this runs. Diverged files are left untouched and
 * reported via `nextSteps`.
 */

const CONSTRUCTS_API_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/api`;
const REST_API_CONSTRUCT = `${CONSTRUCTS_API_DIR}/rest-api.ts`;
const HTTP_API_CONSTRUCT = `${CONSTRUCTS_API_DIR}/http-api.ts`;
const TERRAFORM_APIS_DIR = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/app/apis`;

const hcl = (pattern: string) => `language hcl\n${pattern}`;

/** Whether the pattern matches any `.tf` file in the Terraform module directory. */
const matchesInModule = async (
  tree: Tree,
  moduleDir: string,
  pattern: string,
) => {
  for (const child of tree.children(moduleDir)) {
    const path = joinPathFragments(moduleDir, child);
    if (
      child.endsWith('.tf') &&
      tree.isFile(path) &&
      (await matchGritQL(tree, path, pattern))
    ) {
      return true;
    }
  }
  return false;
};

/** Whether every pattern matches the file. */
const matchesAll = async (tree: Tree, file: string, patterns: string[]) => {
  for (const pattern of patterns) {
    if (!(await matchGritQL(tree, file, pattern))) {
      return false;
    }
  }
  return true;
};

const REST_RUNTIME_CONFIG_URL = `domainName
        ? \`https://\${domainName.domainName}/\${domainName.basePath ? \`\${domainName.basePath}/\` : ''}\`
        : this.api.url!`;

const REST_DOMAIN_OUTPUTS = `// Target for the custom domain's DNS record
    if (domainName) {
      new CfnOutput(this, \`\${apiName}DomainNameAlias\`, {
        value: this.api.domainName!.domainNameAliasDomainName,
        description:
          'Regional domain name to point a CNAME record at for the custom domain, with any DNS provider',
      });
      new CfnOutput(this, \`\${apiName}DomainNameAliasHostedZoneId\`, {
        value: this.api.domainName!.domainNameAliasHostedZoneId,
        description:
          'Hosted zone ID of the regional domain name, needed only for a Route 53 alias record',
      });
    }`;

const HTTP_DOMAIN_OUTPUTS = `// Target for the custom domain's DNS record
    if (defaultDomainMapping) {
      new CfnOutput(this, \`\${apiName}DomainNameAlias\`, {
        value: defaultDomainMapping.domainName.regionalDomainName,
        description:
          'Regional domain name to point a CNAME record at for the custom domain, with any DNS provider',
      });
      new CfnOutput(this, \`\${apiName}DomainNameAliasHostedZoneId\`, {
        value: defaultDomainMapping.domainName.regionalHostedZoneId,
        description:
          'Hosted zone ID of the regional domain name, needed only for a Route 53 alias record',
      });
    }`;

const HTTP_DOMAIN_MAPPING_PROP = `/**
   * Custom domain mapped to the API's default stage
   */
  readonly defaultDomainMapping?: DomainMappingOptions & {
    readonly domainName: IDomainName;
  }`;

/** Matches a DNS record output this migration adds. */
const DOMAIN_ALIAS_OUTPUT =
  '`new CfnOutput(this, $id, $_)` where { $id <: r".*DomainNameAlias.*" }';

/** Rewrite inserting {@link GRIT_INSERT_PLACEHOLDER} after the runtime config registration. */
const AFTER_RUNTIME_CONFIG = `\`$call;\` as $statement where {
  $call <: \`rc.set('connection', 'apis', $_)\`,
  $statement => \`$call;\n\n    ${GRIT_INSERT_PLACEHOLDER}\`
}`;

const migrateRestApiConstruct = async (tree: Tree, nextSteps: string[]) => {
  const file = REST_API_CONSTRUCT;
  if (!tree.exists(file)) {
    return;
  }

  if (await matchGritQL(tree, file, '`[apiName]: domainName ? $_ : $_`')) {
    return; // Already migrated.
  }

  const shape = [
    '`{ $params }: RestApiProps<$_, $_>` where { $params <: contains `...props`, $params <: not contains `domainName` }',
    "`new _RestApi(this, 'Api', { $props })` where { $props <: contains `...props`, $props <: not contains `domainName` }",
    "`rc.set('connection', 'apis', { $entries })` where { $entries <: contains `[apiName]: this.api.url!` }",
  ];
  if (
    !(await matchesAll(tree, file, shape)) ||
    (await matchGritQL(tree, file, DOMAIN_ALIAS_OUTPUT))
  ) {
    nextSteps.push(
      `${file}: has diverged from the generated shape - left untouched. To publish a configured custom domain to clients, destructure \`domainName\` from the constructor props and pass it to the CDK RestApi, register \`https://\${domainName.domainName}/\` (plus any \`basePath\`) under \`[apiName]\` in the \`rc.set('connection', 'apis', ...)\` call when it is set instead of \`this.api.url\`, and output \`this.api.domainName.domainNameAliasDomainName\` / \`domainNameAliasHostedZoneId\` for the DNS record.`,
    );
    return;
  }

  // Taken out of `props` and passed explicitly, so it is in scope below.
  await applyGritQL(
    tree,
    file,
    '`{ $params }: RestApiProps<$_, $_>` where { $params <: contains `...props` as $rest, $rest => `domainName,\n      ...props` }',
  );
  await applyGritQL(
    tree,
    file,
    "`new _RestApi(this, 'Api', { $props })` where { $props <: contains `...props` as $spread, $spread => `...props,\n      domainName` }",
  );
  await insertViaGritQL(
    tree,
    file,
    "`rc.set('connection', 'apis', { $entries })` where { $entries <: contains `[apiName]: this.api.url!` as $url, $url => `[apiName]: __GRIT_INSERT_PLACEHOLDER__` }",
    REST_RUNTIME_CONFIG_URL,
  );
  await insertViaGritQL(tree, file, AFTER_RUNTIME_CONFIG, REST_DOMAIN_OUTPUTS);
  // Listed first, as the generator vends it.
  const imported = await applyGritQL(
    tree,
    file,
    "`import { $names } from 'aws-cdk-lib'` where { $names <: not contains `CfnOutput` } => `import { CfnOutput, $names } from 'aws-cdk-lib'`",
  );
  if (!imported) {
    await addDestructuredImport(tree, file, ['CfnOutput'], 'aws-cdk-lib');
  }
};

const migrateHttpApiConstruct = async (tree: Tree, nextSteps: string[]) => {
  const file = HTTP_API_CONSTRUCT;
  if (!tree.exists(file)) {
    return;
  }

  if (
    await matchGritQL(tree, file, '`[apiName]: defaultDomainMapping ? $_ : $_`')
  ) {
    return; // Already migrated.
  }

  const shape = [
    'interface_declaration(name=$name, body=$body) as $interface where { $name <: `HttpApiProps`, $interface <: contains extends_type_clause() as $extends, $extends <: contains `_HttpApiProps`, $extends <: not contains `Omit`, $body <: contains `readonly throttle?: ThrottleSettings`, $body <: not contains `defaultDomainMapping` }',
    '`{ $params }: HttpApiProps<$_, $_>` where { $params <: contains `...props`, $params <: not contains `defaultDomainMapping` }',
    "`new HttpStage(this, 'DefaultStage', { $props })` where { $props <: contains `httpApi: this.api`, $props <: not contains `domainMapping` }",
    "`rc.set('connection', 'apis', { $entries })` where { $entries <: contains `[apiName]: this.defaultStage.url!` }",
  ];
  if (
    !(await matchesAll(tree, file, shape)) ||
    (await matchGritQL(tree, file, DOMAIN_ALIAS_OUTPUT))
  ) {
    nextSteps.push(
      `${file}: has diverged from the generated shape - left untouched. To support a custom domain, destructure \`defaultDomainMapping\` from the constructor props (so it is not passed to the CDK HttpApi, which rejects it when the default stage is disabled), pass it as \`domainMapping\` to the \`DefaultStage\` HttpStage, register \`this.defaultStage.domainUrl\` under \`[apiName]\` in runtime config when it is set, and output \`defaultDomainMapping.domainName.regionalDomainName\` / \`regionalHostedZoneId\` for the DNS record.`,
    );
    return;
  }

  // Typed as a domain exposing its regional attributes, for the DNS outputs.
  await insertViaGritQL(
    tree,
    file,
    'interface_declaration(name=$name, body=$body) where { $name <: `HttpApiProps`, $body <: contains `readonly throttle?: ThrottleSettings` as $throttle, $throttle => `readonly throttle?: ThrottleSettings;\n  __GRIT_INSERT_PLACEHOLDER__` }',
    HTTP_DOMAIN_MAPPING_PROP,
  );
  // Only the `_HttpApiProps` base is replaced, keeping any others.
  await applyGritQL(
    tree,
    file,
    "interface_declaration(name=$name) as $interface where { $name <: `HttpApiProps`, $interface <: contains extends_type_clause() as $extends, $extends <: contains `_HttpApiProps` as $base, $base => `Omit<_HttpApiProps, 'defaultDomainMapping'>` }",
  );
  await addDestructuredImport(
    tree,
    file,
    ['DomainMappingOptions', 'IDomainName'],
    'aws-cdk-lib/aws-apigatewayv2',
  );
  // Taken out of `props` so it isn't passed to the CDK HttpApi.
  await applyGritQL(
    tree,
    file,
    '`{ $params }: HttpApiProps<$_, $_>` where { $params <: contains `...props` as $rest, $rest => `defaultDomainMapping,\n      ...props` }',
  );
  await applyGritQL(
    tree,
    file,
    "`new HttpStage(this, 'DefaultStage', { $props })` where { $props <: contains `httpApi: this.api` as $httpApi, $httpApi => `httpApi: this.api,\n      domainMapping: defaultDomainMapping` }",
  );
  await applyGritQL(
    tree,
    file,
    "`rc.set('connection', 'apis', { $entries })` where { $entries <: contains `[apiName]: this.defaultStage.url!` as $url, $url => `[apiName]: defaultDomainMapping ? this.defaultStage.domainUrl : this.defaultStage.url!` }",
  );
  await insertViaGritQL(tree, file, AFTER_RUNTIME_CONFIG, HTTP_DOMAIN_OUTPUTS);
};

const TERRAFORM_VARIABLES = `# Custom Domain Configuration
variable "custom_domain_name" {
  description = "Custom domain name for the API. Requires acm_certificate_arn."
  type        = string
  default     = null
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate (in the API's region) for the custom domain name."
  type        = string
  default     = null
}`;

/** The differences between the REST and HTTP Terraform app modules. */
interface TerraformApi {
  kind: 'REST' | 'HTTP';
  /** A block only this kind of app module declares. */
  identifyingBlock: string;
  /** Matches exactly the runtime config `value` the app module was generated with. */
  runtimeConfigUrl: string;
  /** Types of the custom domain and mapping resources this migration adds. */
  domainResourceTypes: [string, string];
  domainResources: string;
  outputs: string;
}

const REST_TERRAFORM: TerraformApi = {
  kind: 'REST',
  identifyingBlock: '`resource "aws_api_gateway_stage" "api_stage" { $_ }`',
  runtimeConfigUrl:
    '$v <: r"\\"\\$\\{aws_api_gateway_stage\\.api_stage\\.invoke_url\\}/\\""',
  domainResourceTypes: [
    'aws_api_gateway_domain_name',
    'aws_api_gateway_base_path_mapping',
  ],
  domainResources: `# Custom domain for the API, served without the stage path prefix
resource "aws_api_gateway_domain_name" "custom_domain" {
  count = var.custom_domain_name == null ? 0 : 1

  domain_name              = var.custom_domain_name
  regional_certificate_arn = var.acm_certificate_arn
  security_policy          = "TLS_1_2"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = var.tags
}

resource "aws_api_gateway_base_path_mapping" "custom_domain" {
  count = var.custom_domain_name == null ? 0 : 1

  api_id      = module.rest_api.api_id
  stage_name  = aws_api_gateway_stage.api_stage.stage_name
  domain_name = aws_api_gateway_domain_name.custom_domain[0].domain_name
}

locals {
  api_url = var.custom_domain_name == null ? "\${aws_api_gateway_stage.api_stage.invoke_url}/" : "https://\${var.custom_domain_name}/"
}`,
  outputs: `output "api_url" {
  description = "URL clients should call: the custom domain if configured, otherwise the stage invoke URL"
  value       = local.api_url
}

output "custom_domain_target_domain_name" {
  description = "Target domain name to point a DNS alias or CNAME record at for the custom domain"
  value       = var.custom_domain_name == null ? null : aws_api_gateway_domain_name.custom_domain[0].regional_domain_name
}

output "custom_domain_hosted_zone_id" {
  description = "Hosted zone ID to use for a Route 53 alias record for the custom domain"
  value       = var.custom_domain_name == null ? null : aws_api_gateway_domain_name.custom_domain[0].regional_zone_id
}`,
};

const HTTP_TERRAFORM: TerraformApi = {
  kind: 'HTTP',
  identifyingBlock: '`module "http_api" { $_ }`',
  runtimeConfigUrl: '$v <: `module.http_api.stage_invoke_url`',
  domainResourceTypes: [
    'aws_apigatewayv2_domain_name',
    'aws_apigatewayv2_api_mapping',
  ],
  domainResources: `# Custom domain for the API
resource "aws_apigatewayv2_domain_name" "custom_domain" {
  count = var.custom_domain_name == null ? 0 : 1

  domain_name = var.custom_domain_name

  domain_name_configuration {
    certificate_arn = var.acm_certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = var.tags
}

resource "aws_apigatewayv2_api_mapping" "custom_domain" {
  count = var.custom_domain_name == null ? 0 : 1

  api_id      = module.http_api.api_id
  stage       = module.http_api.stage_id
  domain_name = aws_apigatewayv2_domain_name.custom_domain[0].id
}

locals {
  api_url = var.custom_domain_name == null ? module.http_api.stage_invoke_url : "https://\${var.custom_domain_name}/"
}`,
  outputs: `output "api_url" {
  description = "URL clients should call: the custom domain if configured, otherwise the stage invoke URL"
  value       = local.api_url
}

output "custom_domain_target_domain_name" {
  description = "Target domain name to point a DNS alias or CNAME record at for the custom domain"
  value       = var.custom_domain_name == null ? null : aws_apigatewayv2_domain_name.custom_domain[0].domain_name_configuration[0].target_domain_name
}

output "custom_domain_hosted_zone_id" {
  description = "Hosted zone ID to use for a Route 53 alias record for the custom domain"
  value       = var.custom_domain_name == null ? null : aws_apigatewayv2_domain_name.custom_domain[0].domain_name_configuration[0].hosted_zone_id
}`,
};

const RUNTIME_CONFIG_MODULE = '`module "add_url_to_runtime_config" { $body }`';

/** Rewrite matching the block's text back unchanged, then the placeholder after it. */
const appendAfterBlock = (header: string) =>
  hcl(
    `\`${header} { $body }\` => \`${header} {\n  $body\n}\n\n${GRIT_INSERT_PLACEHOLDER}\``,
  );

const migrateTerraformApi = async (
  tree: Tree,
  moduleDir: string,
  file: string,
  nextSteps: string[],
) => {
  const api = (await matchGritQL(
    tree,
    file,
    hcl(REST_TERRAFORM.identifyingBlock),
  ))
    ? REST_TERRAFORM
    : (await matchGritQL(tree, file, hcl(HTTP_TERRAFORM.identifyingBlock)))
      ? HTTP_TERRAFORM
      : undefined;
  if (!api) {
    return; // Not a vended API app module.
  }

  // Everything this migration declares, so a re-run recognises its own output
  // and nothing it inserts collides with an existing declaration. Terraform
  // merges every `.tf` file in the module directory, so all are checked.
  const [domainType, mappingType] = api.domainResourceTypes;
  const declarations = [
    '`variable "custom_domain_name" { $_ }`',
    '`variable "acm_certificate_arn" { $_ }`',
    `\`resource "${domainType}" "custom_domain" { $_ }\``,
    `\`resource "${mappingType}" "custom_domain" { $_ }\``,
    '`locals { $body }` where { $body <: contains `api_url = $_` }',
    '`output "api_url" { $_ }`',
    '`output "custom_domain_target_domain_name" { $_ }`',
    '`output "custom_domain_hosted_zone_id" { $_ }`',
  ];
  let declared = 0;
  for (const declaration of declarations) {
    if (await matchesInModule(tree, moduleDir, hcl(declaration))) {
      declared++;
    }
  }
  const publishesApiUrl = await matchGritQL(
    tree,
    file,
    hcl(
      `${RUNTIME_CONFIG_MODULE} where { $body <: contains \`value = { $_ = local.api_url }\` }`,
    ),
  );
  if (declared === declarations.length && publishesApiUrl) {
    return; // Already migrated.
  }
  if (declared > 0 || publishesApiUrl) {
    nextSteps.push(
      `${file}: this module (${moduleDir}) already declares some of the custom domain configuration this migration adds (custom_domain_name / acm_certificate_arn variables, the custom_domain resources, local.api_url, or the api_url / custom_domain_* outputs) - left untouched. Make sure the add_url_to_runtime_config module publishes the custom domain URL when one is configured, instead of the stage invoke URL (see the ${api.kind} API app module the plugin now generates).`,
    );
    return;
  }

  const runtimeConfigValue = `${RUNTIME_CONFIG_MODULE} where { $body <: contains \`value = { $_ = $v }\`, ${api.runtimeConfigUrl} }`;
  const shape = [
    hcl('`variable "tags" { $_ }`'),
    hcl(runtimeConfigValue),
    hcl('`output "stage_invoke_url" { $_ }`'),
  ];
  if (!(await matchesAll(tree, file, shape))) {
    nextSteps.push(
      `${file}: has diverged from the generated shape - left untouched. To support a custom domain for this ${api.kind} API, add custom_domain_name and acm_certificate_arn variables, the custom domain and mapping resources, and publish the custom domain URL in the add_url_to_runtime_config module when it is set (see the ${api.kind} API app module the plugin now generates).`,
    );
    return;
  }

  await insertViaGritQL(
    tree,
    file,
    appendAfterBlock('variable "tags"'),
    TERRAFORM_VARIABLES,
  );
  // Only the URL expression is rewritten, preserving `terraform fmt` alignment.
  await applyGritQL(
    tree,
    file,
    hcl(
      `${RUNTIME_CONFIG_MODULE} where { $body <: contains \`value = { $_ = $v }\`, ${api.runtimeConfigUrl}, $v => \`local.api_url\` }`,
    ),
  );
  await insertViaGritQL(
    tree,
    file,
    appendAfterBlock('module "add_url_to_runtime_config"'),
    api.domainResources,
  );
  await insertViaGritQL(
    tree,
    file,
    appendAfterBlock('output "stage_invoke_url"'),
    api.outputs,
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  await migrateRestApiConstruct(tree, nextSteps);
  await migrateHttpApiConstruct(tree, nextSteps);

  if (tree.exists(TERRAFORM_APIS_DIR)) {
    for (const dirName of tree.children(TERRAFORM_APIS_DIR)) {
      const moduleDir = joinPathFragments(TERRAFORM_APIS_DIR, dirName);
      const file = joinPathFragments(moduleDir, `${dirName}.tf`);
      if (tree.exists(file)) {
        await migrateTerraformApi(tree, moduleDir, file, nextSteps);
      }
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
