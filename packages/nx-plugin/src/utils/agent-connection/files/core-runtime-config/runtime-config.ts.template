import { getAppConfig } from '@aws-lambda-powertools/parameters/appconfig';

/**
 * Read the runtime-config `agentcore` namespace from AppConfig.
 * `RUNTIME_CONFIG_APP_ID` is set on the AgentCore runtime by the generated
 * CDK/Terraform construct for this project.
 */
const getAgentCoreRuntimeConfig = async (): Promise<{
  agentRuntimes?: Record<string, string>;
}> => {
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
  })) as { agentRuntimes?: Record<string, string> };
};

/**
 * Resolve the AgentCore runtime ARN for a connected agent or MCP server
 * from this project's runtime configuration. `name` must match the class
 * name of the target construct (e.g. `MyAgent`, `InventoryMcpServer`).
 */
export const getConnectedAgentRuntimeArn = async (
  name: string,
): Promise<string> => {
  const config = await getAgentCoreRuntimeConfig();
  const arn = config.agentRuntimes?.[name];
  if (!arn) {
    throw new Error(
      `No connected agent runtime named '${name}' found in runtime configuration.`,
    );
  }
  return arn;
};
