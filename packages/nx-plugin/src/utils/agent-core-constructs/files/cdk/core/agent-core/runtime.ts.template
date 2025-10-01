import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
  PolicyDocument,
  IGrantable,
  Grant,
  IPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { CfnRuntime } from 'aws-cdk-lib/aws-bedrockagentcore';

/**
 * Options for the AgentCoreRuntime construct
 */
export interface AgentCoreRuntimeProps {
  runtimeName: string;
  description?: string;
  containerUri: string;
  serverProtocol: 'MCP' | 'HTTP';
  environment?: Record<string, string>;
  authorizerConfiguration?: CfnRuntime.AuthorizerConfigurationProperty;
}

/**
 * A construct for creating a Bedrock AgentCore Runtime
 */
export class AgentCoreRuntime extends Construct implements IGrantable {
  public readonly role: Role;
  public readonly arn: string;

  public readonly grantPrincipal: IPrincipal;

  constructor(scope: Construct, id: string, props: AgentCoreRuntimeProps) {
    super(scope, id);

    const region = Stack.of(this).region;
    const accountId = Stack.of(this).account;

    this.role = new Role(this, 'AgentCoreRole', {
      assumedBy: new ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      inlinePolicies: {
        AgentCorePolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: 'ECRImageAccess',
              effect: Effect.ALLOW,
              actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
              resources: [`arn:aws:ecr:${region}:${accountId}:repository/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
              resources: [
                `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*`,
              ],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['logs:DescribeLogGroups'],
              resources: [`arn:aws:logs:${region}:${accountId}:log-group:*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: [
                `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
              ],
            }),
            new PolicyStatement({
              sid: 'ECRTokenAccess',
              effect: Effect.ALLOW,
              actions: ['ecr:GetAuthorizationToken'],
              resources: ['*'],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
                'xray:GetSamplingRules',
                'xray:GetSamplingTargets',
              ],
              resources: ['*'],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['cloudwatch:PutMetricData'],
              resources: ['*'],
              conditions: {
                StringEquals: {
                  'cloudwatch:namespace': 'bedrock-agentcore',
                },
              },
            }),
            new PolicyStatement({
              sid: 'GetAgentAccessToken',
              effect: Effect.ALLOW,
              actions: [
                'bedrock-agentcore:GetWorkloadAccessToken',
                'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
                'bedrock-agentcore:GetWorkloadAccessTokenForUserId',
              ],
              resources: [
                `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default`,
                `arn:aws:bedrock-agentcore:${region}:${accountId}:workload-identity-directory/default/workload-identity/*`,
              ],
            }),
            new PolicyStatement({
              sid: 'BedrockModelInvocation',
              effect: Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: [
                'arn:aws:bedrock:*::foundation-model/*',
                `arn:aws:bedrock:${region}:${accountId}:*`,
              ],
            }),
          ],
        }),
      },
    });
    this.grantPrincipal = this.role.grantPrincipal;

    const agentRuntime = new CfnRuntime(this, 'MCPServerRuntime', {
      agentRuntimeName: props.runtimeName,
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: props.containerUri,
        },
      },
      description: props.description,
      environmentVariables: props.environment,
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },
      protocolConfiguration: props.serverProtocol,
      roleArn: this.role.roleArn,
      authorizerConfiguration: props.authorizerConfiguration,
    });

    this.arn = agentRuntime.attrAgentRuntimeArn;
  }

  /**
   * Grant permissions to invoke the agent runtime (if using IAM auth - not required for JWT auth)
   */
  public grantInvoke = (grantee: IGrantable) => {
    Grant.addToPrincipal({
      grantee,
      actions: ['bedrock-agentcore:InvokeAgentRuntime'],
      resourceArns: [this.arn, `${this.arn}/*`],
    });
  };
}
