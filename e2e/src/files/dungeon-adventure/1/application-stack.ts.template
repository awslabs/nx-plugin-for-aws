import {
  GameApi,
  GameUI,
  InventoryMcpServer,
  RuntimeConfig,
  StoryAgent,
  UserIdentity,
} from ':dungeon-adventure/common-constructs';
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const userIdentity = new UserIdentity(this, 'UserIdentity');

    const gameApi = new GameApi(this, 'GameApi', {
      integrations: GameApi.defaultIntegrations(this).build(),
    });

    const { userPool, userPoolClient } = userIdentity;

    const mcpServer = new InventoryMcpServer(this, 'InventoryMcpServer');

    // Use Cognito for user authentication with the agent
    const storyAgent = new StoryAgent(this, 'StoryAgent', {
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: `https://cognito-idp.${Stack.of(userPool).region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
          allowedAudience: [userPoolClient.userPoolClientId],
        },
      },
      environment: {
        INVENTORY_MCP_ARN: mcpServer.agentCoreRuntime.arn,
      },
    });
    // Add the Story Agent ARN to runtime-config.json so it can be referenced by the website
    RuntimeConfig.ensure(this).config.agentArn =
      storyAgent.agentCoreRuntime.arn;

    new CfnOutput(this, 'StoryAgentArn', {
      value: storyAgent.agentCoreRuntime.arn,
    });
    new CfnOutput(this, 'InventoryMcpArn', {
      value: mcpServer.agentCoreRuntime.arn,
    });

    // Grant the agent permissions to invoke our mcp server
    mcpServer.agentCoreRuntime.grantInvoke(storyAgent.agentCoreRuntime);

    // Grant the authenticated role access to invoke the api
    gameApi.grantInvokeAccess(userIdentity.identityPool.authenticatedRole);

    // Ensure this is instantiated last so our runtime-config.json can be automatically configured
    new GameUI(this, 'GameUI');
  }
}
