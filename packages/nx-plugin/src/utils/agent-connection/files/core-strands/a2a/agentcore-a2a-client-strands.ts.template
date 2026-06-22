import { A2AAgent } from '@strands-agents/sdk/a2a';
import {
  type A2aClientConfig,
  AgentCoreA2aClientConfig,
  type AgentCoreA2aClientConfigIamOptions,
  type AgentCoreA2aClientConfigJwtOptions,
  type AgentCoreA2aClientConfigNoAuthOptions,
} from './agentcore-a2a-client-config.js';

/** Optional friendly metadata for the remote agent. */
export interface StrandsA2aOptions {
  /** Optional friendly name for the remote agent. */
  name?: string;
  /** Optional description for the remote agent. */
  description?: string;
}

/** Strands A2A clients for a Bedrock AgentCore runtime. */
export class AgentCoreA2aClientStrands {
  private static build(
    { url, clientFactory }: A2aClientConfig,
    options: StrandsA2aOptions,
  ): A2AAgent {
    return new A2AAgent({
      url,
      clientFactory,
      ...(options.name ? { name: options.name } : {}),
      ...(options.description ? { description: options.description } : {}),
    });
  }

  /** SigV4-authenticated client for a Bedrock AgentCore runtime. */
  static withIamAuth(
    options: AgentCoreA2aClientConfigIamOptions & StrandsA2aOptions,
  ): A2AAgent {
    return AgentCoreA2aClientStrands.build(
      AgentCoreA2aClientConfig.withIamAuth(options),
      options,
    );
  }

  /** Bearer-authenticated client for a Bedrock AgentCore runtime. */
  static withJwtAuth(
    options: AgentCoreA2aClientConfigJwtOptions & StrandsA2aOptions,
  ): A2AAgent {
    return AgentCoreA2aClientStrands.build(
      AgentCoreA2aClientConfig.withJwtAuth(options),
      options,
    );
  }

  /** For local dev — plain HTTP, no auth. */
  static withoutAuth(
    options: AgentCoreA2aClientConfigNoAuthOptions & StrandsA2aOptions,
  ): A2AAgent {
    return AgentCoreA2aClientStrands.build(
      AgentCoreA2aClientConfig.withoutAuth(options),
      options,
    );
  }
}
