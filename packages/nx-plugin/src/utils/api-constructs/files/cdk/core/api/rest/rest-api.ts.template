import { Construct, IConstruct } from 'constructs';
import {
  AccessLogFormat,
  Cors,
  LogGroupLogDestination,
  Resource,
  RestApi as _RestApi,
  RestApiProps as _RestApiProps,
  IResource,
  Stage,
  ThrottleSettings,
} from 'aws-cdk-lib/aws-apigateway';
import { IAspect, Stack } from 'aws-cdk-lib';
import {
  CfnLoggingConfiguration,
  CfnWebACL,
  CfnWebACLAssociation,
} from 'aws-cdk-lib/aws-wafv2';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Key } from 'aws-cdk-lib/aws-kms';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { RuntimeConfig } from '../runtime-config.js';
import { ApiGatewayAccount } from './api-gateway-account.js';
import {
  ApiIntegrations,
  OperationDetails,
  RestApiIntegration,
} from './utils.js';
import { suppressRules } from '../checkov.js';

/**
 * Properties for creating a RestApi construct.
 *
 * @template TIntegrations - Record mapping integration keys to their integrations
 * @template TOperation - String literal type representing operation names
 */
export interface RestApiProps<
  TIntegrations extends ApiIntegrations<TOperation, RestApiIntegration>,
  TOperation extends string,
> extends _RestApiProps {
  /**
   * Unique name for the API, used in runtime configuration
   */
  readonly apiName: string;
  /**
   * Map of operation names to their API path and HTTP method details
   */
  readonly operations: Record<TOperation, OperationDetails>;
  /**
   * Map of integration keys to their API Gateway integrations
   */
  readonly integrations: TIntegrations;
  /**
   * Whether to enable AWS WAFv2 with the default managed ruleset
   * (AWSManagedRulesCommonRuleSet and AWSManagedRulesKnownBadInputsRuleSet)
   * and associate it with the API's default stage.
   *
   * @default true
   */
  readonly enableWaf?: boolean;
  /**
   * Default throttling limits applied to all methods on the API's default stage.
   *
   * @default { rateLimit: 10000, burstLimit: 5000 }
   */
  readonly throttle?: ThrottleSettings;
}

/**
 * A CDK construct that creates and configures an AWS API Gateway REST API.
 *
 * This class extends the base CDK RestApi with additional functionality:
 * - Type-safe operation and integration management
 * - Automatic resource creation based on path patterns
 * - Integration with runtime configuration for client discovery
 *
 * @template TOperation - String literal type representing operation names
 * @template TIntegrations - Record mapping integration keys to their integrations
 */
export class RestApi<
  TOperation extends string,
  TIntegrations extends ApiIntegrations<TOperation, RestApiIntegration>,
> extends Construct {
  /** The underlying CDK RestApi instance */
  public readonly api: _RestApi;

  /** Map of integration keys to their API Gateway integrations */
  public readonly integrations: TIntegrations;

  /** The WAFv2 Web ACL associated with the API's default stage, if WAF is enabled */
  public readonly webAcl?: CfnWebACL;

  constructor(
    scope: Construct,
    id: string,
    {
      apiName,
      operations,
      integrations,
      enableWaf = true,
      throttle = { rateLimit: 10000, burstLimit: 5000 },
      ...props
    }: RestApiProps<TIntegrations, TOperation>,
  ) {
    super(scope, id);
    this.integrations = integrations;

    // Account-level CloudWatch role required for REST API access logging
    const account = ApiGatewayAccount.ensure(this);

    // KMS key for encrypting logs at rest, usable by CloudWatch Logs
    const logsKey = new Key(this, 'LogsKey', {
      enableKeyRotation: true,
    });
    logsKey.grantEncryptDecrypt(
      new ServicePrincipal(`logs.${Stack.of(this).region}.amazonaws.com`),
    );

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: RetentionDays.ONE_YEAR,
      encryptionKey: logsKey,
    });

    // Create the API Gateway REST API
    this.api = new _RestApi(this, 'Api', {
      ...props,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(accessLogs),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        ...props.deployOptions,
        methodOptions: {
          ...props.deployOptions?.methodOptions,
          // Default throttling applied to all resource paths and methods
          '/*/*': {
            throttlingRateLimit: throttle.rateLimit,
            throttlingBurstLimit: throttle.burstLimit,
            ...props.deployOptions?.methodOptions?.['/*/*'],
          },
        },
      },
    });
    // Ensure the account-level role is configured before the stage is created
    this.api.deploymentStage.node.addDependency(account.resource);

    if (enableWaf) {
      this.webAcl = new CfnWebACL(this, 'WebAcl', {
        defaultAction: { allow: {} },
        scope: 'REGIONAL',
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${apiName}WebAcl`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: 'CRSRule',
            priority: 0,
            statement: {
              managedRuleGroupStatement: {
                name: 'AWSManagedRulesCommonRuleSet',
                vendorName: 'AWS',
                // Count instead of Block: the CRS 8 KB body limit is too restrictive for most APIs.
                ruleActionOverrides: [
                  {
                    name: 'SizeRestrictions_BODY',
                    actionToUse: { count: {} },
                  },
                ],
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${apiName}WebAcl-CRS`,
              sampledRequestsEnabled: true,
            },
            overrideAction: {
              none: {},
            },
          },
          {
            name: 'KnownBadInputsRule',
            priority: 1,
            statement: {
              managedRuleGroupStatement: {
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
                vendorName: 'AWS',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${apiName}WebAcl-KnownBadInputs`,
              sampledRequestsEnabled: true,
            },
            overrideAction: {
              none: {},
            },
          },
        ],
      });

      new CfnWebACLAssociation(this, 'WebAclAssociation', {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: this.webAcl.attrArn,
      });

      // Send WAF request logs to CloudWatch. The log group name must start with
      // `aws-waf-logs-` to satisfy the WAFv2 logging destination requirement.
      const wafLogGroup = new LogGroup(this, 'WebAclLogs', {
        logGroupName: `aws-waf-logs-${apiName}-${this.node.addr.slice(-8)}`,
        retention: RetentionDays.ONE_YEAR,
        encryptionKey: logsKey,
      });

      new CfnLoggingConfiguration(this, 'WebAclLoggingConfig', {
        resourceArn: this.webAcl.attrArn,
        logDestinationConfigs: [wafLogGroup.logGroupArn],
      });
    }

    suppressRules(
      this.api,
      ['CKV_AWS_120'],
      'Caching not required for this use case',
      (c) => c instanceof Stage,
    );

    // Resolve the integration for a given operation.
    // If the operation has a dedicated integration, use it; otherwise fall back to $router.
    const resolveIntegration = (op: TOperation): RestApiIntegration => {
      const record = integrations as Record<string, RestApiIntegration>;
      if (op in record) {
        return record[op];
      }
      if ('$router' in record) {
        return record['$router'];
      }
      throw new Error(
        `No integration found for operation '${op}' and no $router integration available`,
      );
    };

    // Create API resources and methods for each operation
    (Object.entries(operations) as [TOperation, OperationDetails][]).forEach(
      ([op, details]) => {
        const integration = resolveIntegration(op);
        const resource = this.getOrCreateResource(
          this.api.root,
          (details.path.startsWith('/')
            ? details.path.slice(1)
            : details.path
          ).split('/'),
        );
        resource.addMethod(
          details.method,
          integration.integration,
          integration.options,
        );
      },
    );

    // Register the API URL in runtime configuration for client discovery
    const rc = RuntimeConfig.ensure(this);
    rc.set('connection', 'apis', {
      ...rc.get('connection').apis,
      [apiName]: this.api.url!,
    });
  }

  /**
   * Recursively creates or retrieves API Gateway resources based on a path pattern.
   *
   * @param resource - The parent API Gateway resource
   * @param pathParts - Array of path segments to create or retrieve
   * @returns The API Gateway resource at the end of the path
   */
  private getOrCreateResource(
    resource: IResource,
    [nextPathPart, ...pathParts]: string[],
  ): IResource {
    if (!nextPathPart) {
      return resource;
    }
    const childResource =
      resource.getResource(nextPathPart) ?? resource.addResource(nextPathPart);
    return this.getOrCreateResource(childResource, pathParts);
  }
}

export class AddCorsPreflightAspect implements IAspect {
  private getAllowedOrigins: () => readonly string[];
  constructor(getAllowedOrigins: () => readonly string[]) {
    this.getAllowedOrigins = getAllowedOrigins;
  }
  public visit(node: IConstruct): void {
    if (node instanceof Resource) {
      node.addCorsPreflight({
        allowOrigins: [...this.getAllowedOrigins()],
        allowMethods: Cors.ALL_METHODS,
      });
    }
  }
}
