import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const COGNITO_HOSTED_UI_BASE = process.env.COGNITO_HOSTED_UI_BASE!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const params = new URLSearchParams(event.rawQueryString ?? '');

  console.log('[authorize]', {
    scope: params.get('scope'),
    redirect_uri: params.get('redirect_uri'),
    has_resource: params.has('resource'),
  });

  // RFC 8707 `resource` parameter binds the access token's `aud` claim to
  // the given URL. Cognito accepts it at /authorize but rejects the token
  // exchange with `invalid_grant` when the URL is not registered as a
  // resource server. MCP clients send this unconditionally, so strip it.
  params.delete('resource');

  const target = `${COGNITO_HOSTED_UI_BASE}/oauth2/authorize?${params.toString()}`;
  return {
    statusCode: 302,
    headers: { location: target },
    body: '',
  };
};
