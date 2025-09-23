import { Construct } from 'constructs';
import { RuntimeConfig } from '../runtime-config.js';
import { HttpApiIntegration, OperationDetails } from './utils.js';
import { CfnOutput } from 'aws-cdk-lib';
import {
  HttpApi as _HttpApi,
  HttpApiProps as _HttpApiProps,
  HttpMethod,
  HttpStage,
  LogGroupLogDestination,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { suppressRules } from '../checkov.js';

/**
 * Properties for creating an HttpApi construct.
 *
 * @template TIntegrations - Record mapping operation names to their integrations
 * @template TOperation - String literal type representing operation names
 */
export interface HttpApiProps<
  TIntegrations extends Record<TOperation, HttpApiIntegration>,
  TOperation extends string,
> extends _HttpApiProps {
  /**
   * Unique name for the API, used in runtime configuration
   */
  readonly apiName: string;
  /**
   * Map of operation names to their API path and HTTP method details
   */
  readonly operations: Record<TOperation, OperationDetails>;
  /**
   * Map of operation names to their API Gateway integrations
   */
  readonly integrations: TIntegrations;
}

/**
 * A CDK construct that creates and configures an AWS API Gateway HTTP API.
 *
 * This class extends the base CDK HttpApi with additional functionality:
 * - Type-safe operation and integration management
 * - Automatic resource creation based on path patterns
 * - Integration with runtime configuration for client discovery
 *
 * @template TOperation - String literal type representing operation names
 * @template TIntegrations - Record mapping operation names to their integrations
 */
export class HttpApi<
  TOperation extends string,
  TIntegrations extends Record<TOperation, HttpApiIntegration>,
> extends Construct {
  /** The underlying CDK HttpApi instance */
  public readonly api: _HttpApi;

  /** Default auto-deployed stage */
  public readonly defaultStage: HttpStage;

  /** Map of operation names to their API Gateway integrations */
  public readonly integrations: TIntegrations;

  constructor(
    scope: Construct,
    id: string,
    {
      apiName,
      operations,
      integrations,
      ...props
    }: HttpApiProps<TIntegrations, TOperation>,
  ) {
    super(scope, id);
    this.integrations = integrations;

    // Create the API Gateway REST API
    this.api = new _HttpApi(this, 'Api', {
      createDefaultStage: false,
      ...props,
    });

    const accessLogGroup = new LogGroup(this, 'AccessLogs');
    suppressRules(
      accessLogGroup,
      ['CKV_AWS_158'],
      'Using default CloudWatch log encryption',
    );
    suppressRules(
      accessLogGroup,
      ['CKV_AWS_66', 'CKV_AWS_338'],
      'Logs are retained forever',
    );

    this.defaultStage = new HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      autoDeploy: true,
      accessLogSettings: {
        destination: new LogGroupLogDestination(accessLogGroup),
      },
    });

    // Create API resources and methods for each operation
    (Object.entries(operations) as [TOperation, OperationDetails][]).map(
      ([op, details]) => {
        this.api.addRoutes({
          path: details.path.startsWith('/')
            ? details.path
            : `/${details.path}`,
          methods: [details.method as HttpMethod],
          integration: integrations[op].integration,
          ...integrations[op].options,
        });
      },
    );

    new CfnOutput(this, `${apiName}Url`, {
      value: this.defaultStage.url!,
    });

    // Register the API URL in runtime configuration for client discovery
    RuntimeConfig.ensure(this).config.apis = {
      ...RuntimeConfig.ensure(this).config.apis!,
      [apiName]: this.defaultStage.url!,
    };
  }

  /**
   * Return the API url
   */
  public get url() {
    return this.defaultStage.url;
  }
}
