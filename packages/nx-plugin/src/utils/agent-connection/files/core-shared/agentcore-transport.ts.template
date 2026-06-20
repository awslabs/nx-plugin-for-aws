import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
  createSigV4Fetch,
  createJwtFetch,
  createPlainFetch,
} from './agentcore-fetch.js';

const build = (
  url: string,
  fetchFn: typeof fetch,
): StreamableHTTPClientTransport =>
  new StreamableHTTPClientTransport(new URL(url), { fetch: fetchFn });

/** SigV4-signed transport for a resolved AgentCore endpoint. */
export const sigV4Transport = (options: {
  region: string;
  url: string;
  credentialProvider?: ReturnType<typeof fromNodeProviderChain>;
}): StreamableHTTPClientTransport =>
  build(
    options.url,
    createSigV4Fetch({
      region: options.region,
      credentialProvider: options.credentialProvider,
    }),
  );

/** Bearer-token transport for a resolved AgentCore endpoint. */
export const jwtTransport = (options: {
  url: string;
  accessTokenProvider: () => Promise<string>;
}): StreamableHTTPClientTransport =>
  build(options.url, createJwtFetch(options.accessTokenProvider));

/** Plain-HTTP transport — for local dev. */
export const noAuthTransport = (options: {
  url: string;
}): StreamableHTTPClientTransport => build(options.url, createPlainFetch());
