import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';

/**
 * Shape of this project's runtime configuration in AppConfig. Keys are the
 * class names of connected target constructs (e.g. `MyAgent`, `MyGateway`).
 */
export interface AgentCoreRuntimeConfig {
  agentRuntimes?: Record<string, string>;
  gateways?: Record<string, string>;
}

/**
 * Read the runtime-config `agentcore` namespace from AppConfig.
 * `RUNTIME_CONFIG_APP_ID` is set on the AgentCore runtime by the generated
 * CDK/Terraform construct for this project.
 */
export const getAgentCoreRuntimeConfig =
  async (): Promise<AgentCoreRuntimeConfig> => {
    const application = process.env.RUNTIME_CONFIG_APP_ID;
    if (!application) {
      throw new Error(
        'RUNTIME_CONFIG_APP_ID is not set — cannot resolve connected agent ARNs from AppConfig.',
      );
    }
    return (await getAppConfig('agentcore', {
      application,
      environment: 'default',
      transform: 'json',
    })) as AgentCoreRuntimeConfig;
  };
