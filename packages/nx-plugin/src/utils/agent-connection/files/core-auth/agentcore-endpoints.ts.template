/**
 * Resolve Bedrock AgentCore invocation endpoints from a runtime ARN.
 * Framework-agnostic — reusable by any framework's connection client.
 */

/** Extract the AWS region from a Bedrock AgentCore runtime ARN. */
export const regionFromArn = (agentRuntimeArn: string): string =>
  agentRuntimeArn.split(':')[3];

/**
 * The MCP invocation URL for a runtime ARN.
 * ARN format: arn:partition:service:region:account-id:resource
 */
export const mcpUrlFromArn = (agentRuntimeArn: string): string => {
  const region = regionFromArn(agentRuntimeArn);
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(agentRuntimeArn)}/invocations?qualifier=DEFAULT`;
};

/**
 * The A2A invocation URL for a runtime ARN. A2A on AgentCore is mounted at the
 * `/invocations/` root (trailing slash matters).
 */
export const a2aUrlFromArn = (agentRuntimeArn: string): string => {
  const region = regionFromArn(agentRuntimeArn);
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(agentRuntimeArn)}/invocations/`;
};

/** Extract the AWS region from an AgentCore Gateway MCP URL. */
export const regionFromGatewayUrl = (gatewayUrl: string): string => {
  const match = /\.bedrock-agentcore\.([^.]+)\.amazonaws\.com/.exec(gatewayUrl);
  if (!match) {
    throw new Error(
      `Cannot determine region from gateway URL '${gatewayUrl}'. Pass region explicitly.`,
    );
  }
  return match[1];
};
