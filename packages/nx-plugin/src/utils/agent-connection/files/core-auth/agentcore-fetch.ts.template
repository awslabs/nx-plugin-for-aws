import { AwsClient } from 'aws4fetch';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { getCurrentSessionId } from './session-context.js';

const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/** Wrap a fetch so each request carries the current async-context session id. */
const withSessionHeader =
  (inner: typeof fetch): typeof fetch =>
  async (input, init) => {
    const headers = new Headers(init?.headers);
    const sessionId = getCurrentSessionId();
    if (sessionId) headers.set(SESSION_HEADER, sessionId);
    return inner(input, { ...init, headers });
  };

/** Options for a SigV4-signing fetch. */
export interface SigV4FetchOptions {
  /** AWS region to sign for. */
  region: string;
  /** AWS service to sign for. Defaults to `bedrock-agentcore`. */
  service?: string;
  /** AWS credential provider; defaults to the standard provider chain. */
  credentialProvider?: ReturnType<typeof fromNodeProviderChain>;
}

/** A fetch that signs every request with AWS SigV4 (per-request, body-aware). */
export const createSigV4Fetch = (options: SigV4FetchOptions): typeof fetch => {
  const { region, service = 'bedrock-agentcore' } = options;
  const credentialProvider =
    options.credentialProvider ?? fromNodeProviderChain();
  const signedFetch: typeof fetch = async (...args) => {
    const client = new AwsClient({
      ...(await credentialProvider()),
      service,
      region,
    });
    return client.fetch(...args);
  };
  return withSessionHeader(signedFetch);
};

/** A fetch that adds a bearer token from the given async provider. */
export const createJwtFetch = (
  accessTokenProvider: () => Promise<string>,
): typeof fetch =>
  withSessionHeader(async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${await accessTokenProvider()}`);
    return fetch(input, { ...init, headers });
  });

/** A plain fetch (local dev) that still forwards the session id. */
export const createPlainFetch = (): typeof fetch => withSessionHeader(fetch);
