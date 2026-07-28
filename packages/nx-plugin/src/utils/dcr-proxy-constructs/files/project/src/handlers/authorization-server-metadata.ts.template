import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const COGNITO_ISSUER = process.env.COGNITO_ISSUER!;

let cached: Record<string, unknown> | undefined;

async function fetchUpstream(): Promise<Record<string, unknown>> {
  if (cached) return cached;
  const res = await fetch(`${COGNITO_ISSUER}/.well-known/openid-configuration`);
  if (!res.ok) {
    throw new Error(`Cognito discovery failed: ${res.status} ${res.statusText}`);
  }
  cached = (await res.json()) as Record<string, unknown>;
  return cached;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const proxyUrl = `https://${event.requestContext.domainName}`;
  const upstream = await fetchUpstream();

  // Override the proxy-handled endpoints.
  // jwks_uri is kept as Cognito's so JWT verification works directly against
  // Cognito. issuer is kept as Cognito's so JWT.iss validation matches.
  // authorization_endpoint points to the proxy so we can strip the RFC 8707
  // `resource` parameter that some MCP clients send (Cognito rejects token
  // exchange for unregistered resource server URLs).
  const metadata = {
    ...upstream,
    authorization_endpoint: `${proxyUrl}/authorize`,
    token_endpoint: `${proxyUrl}/oauth/token`,
    registration_endpoint: `${proxyUrl}/register`,
  };

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(metadata),
  };
};
