import {
  ArnFormat,
  Aspects,
  CfnOutput,
  Lazy,
  Names,
  Stack,
  Stage,
} from 'aws-cdk-lib';
import {
  CfnApplication,
  CfnConfigurationProfile,
  CfnDeployment,
  CfnDeploymentStrategy,
  CfnEnvironment,
  CfnHostedConfigurationVersion,
} from 'aws-cdk-lib/aws-appconfig';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct, IConstruct } from 'constructs';

const RuntimeConfigKey = '__RuntimeConfig__';

/**
 * Stage-scoped singleton that collects runtime configuration from CDK constructs
 * and delivers it to server-side (AppConfig) and client-side (S3) consumers.
 *
 * Configuration is organised into namespaces (mapped to AppConfig Configuration Profiles):
 * ```ts
 * const rc = RuntimeConfig.ensure(this);
 * rc.set('connection', 'cognitoProps', { region: '...', userPoolId: '...' });
 * rc.set('tables', 'users', { tableName: '...', arn: '...' });
 * ```
 */
export class RuntimeConfig extends Construct {
  private readonly _namespaces = new Map<string, Record<string, any>>();
  private _appConfigApplicationId?: string;
  private _appConfigApplicationArn?: string;
  private _aspectRegistered = false;

  static ensure(scope: Construct): RuntimeConfig {
    const parent = Stage.of(scope) ?? Stack.of(scope);
    return (
      RuntimeConfig.of(scope) ?? new RuntimeConfig(parent, RuntimeConfigKey)
    );
  }

  static of(scope: Construct): RuntimeConfig | undefined {
    const parent = Stage.of(scope) ?? Stack.of(scope);
    return parent.node.tryFindChild(RuntimeConfigKey) as
      | RuntimeConfig
      | undefined;
  }

  constructor(scope: Construct, id: string) {
    super(scope, id);
  }

  /** Sets a key in the given namespace. Creates the namespace if it doesn't exist. */
  set(namespace: string, key: string, value: any): void {
    let data = this._namespaces.get(namespace);
    if (!data) {
      data = {};
      this._namespaces.set(namespace, data);
    }
    data[key] = value;
  }

  /** Returns the config data for a namespace. Creates it if it doesn't exist. */
  get(namespace: string): Record<string, any> {
    let data = this._namespaces.get(namespace);
    if (!data) {
      data = {};
      this._namespaces.set(namespace, data);
    }
    return data;
  }

  /** Returns a lazy token resolving to the AppConfig Application ID. */
  get appConfigApplicationId(): string {
    this.ensureAspect();
    return Lazy.string({
      produce: () => {
        if (!this._appConfigApplicationId) {
          throw new Error(
            'RuntimeConfig AppConfig resources were not created.',
          );
        }
        return this._appConfigApplicationId;
      },
    });
  }

  /** Grants a server-side consumer permission to read from AppConfig. */
  grantReadAppConfig(grantee: IGrantable): Grant {
    this.ensureAspect();
    return Grant.addToPrincipal({
      grantee,
      actions: [
        'appconfig:StartConfigurationSession',
        'appconfig:GetLatestConfiguration',
      ],
      resourceArns: [
        Lazy.string({ produce: () => this._appConfigApplicationArn }),
      ],
    });
  }

  private ensureAspect(): void {
    if (this._aspectRegistered) return;
    this._aspectRegistered = true;
    let created = false;

    Aspects.of(this.node.scope!).add({
      visit: (node: IConstruct) => {
        if (created || !(node instanceof Stack)) return;
        created = true;

        const stack = node;
        const name = Names.uniqueResourceName(this, {
          maxLength: 64,
          separator: '-',
        });

        const app = new CfnApplication(stack, 'RcAppConfigApp', { name });
        const strategy = new CfnDeploymentStrategy(
          stack,
          'RcAppConfigStrategy',
          {
            name,
            deploymentDurationInMinutes: 0,
            growthFactor: 100,
            replicateTo: 'NONE',
            finalBakeTimeInMinutes: 0,
          },
        );
        const env = new CfnEnvironment(stack, 'RcAppConfigEnv', {
          applicationId: app.ref,
          name: 'default',
        });

        for (const [ns, data] of this._namespaces.entries()) {
          const profile = new CfnConfigurationProfile(
            stack,
            `RcAppConfigProfile${ns}`,
            {
              applicationId: app.ref,
              name: ns,
              locationUri: 'hosted',
              type: 'AWS.Freeform',
            },
          );
          const version = new CfnHostedConfigurationVersion(
            stack,
            `RcAppConfigVersion${ns}`,
            {
              applicationId: app.ref,
              configurationProfileId: profile.ref,
              contentType: 'application/json',
              content: Lazy.string({ produce: () => stack.toJsonString(data) }),
            },
          );
          new CfnDeployment(stack, `RcAppConfigDeploy${ns}`, {
            applicationId: app.ref,
            environmentId: env.ref,
            configurationProfileId: profile.ref,
            configurationVersion: version.ref,
            deploymentStrategyId: strategy.ref,
          });
        }

        new CfnOutput(stack, 'RuntimeConfigApplicationId', { value: app.ref });
        this._appConfigApplicationId = app.ref;
        this._appConfigApplicationArn = stack.formatArn({
          service: 'appconfig',
          resource: 'application',
          resourceName: `${app.ref}/*`,
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
        });
      },
    });
  }
}
