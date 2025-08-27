import { Stack, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';

const RuntimeConfigKey = '__RuntimeConfig__';

export class RuntimeConfig extends Construct {
  private readonly _runtimeConfig: any = {};

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

  get config(): any {
    return this._runtimeConfig;
  }
}
