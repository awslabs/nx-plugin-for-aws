import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const COGNITO_HOSTED_UI_BASE = process.env.COGNITO_HOSTED_UI_BASE!;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID!;
const COGNITO_CLIENT_SECRET_ARN = process.env.COGNITO_CLIENT_SECRET_ARN!;
const COGNITO_REGION = process.env.COGNITO_REGION!;

const sm = new SecretsManagerClient({ region: COGNITO_REGION });
let cachedSecret: string | undefined;

async function getClientSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const res = await sm.send(
    new GetSecretValueCommand({ SecretId: COGNITO_CLIENT_SECRET_ARN }),
  );
  if (!res.SecretString) {
    throw new Error('client_secret missing in Secrets Manager');
  }
  cachedSecret = res.SecretString;
  return cachedSecret;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (!event.body) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: 'invalid_request',
        error_description: 'request body is required',
      }),
    };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;

  const params = new URLSearchParams(rawBody);

  // Always force the real Cognito client_id and inject the server-side secret.
  // DCR returned the same client_id to every caller, but we re-assert here
  // to keep client_id/secret consistent regardless of what the caller sent.
  params.set('client_id', COGNITO_CLIENT_ID);
  params.set('client_secret', await getClientSecret());

  // Cognito does not understand RFC 8707 `resource`; some MCP clients send it
  // and Cognito has been observed to reject the exchange when present.
  params.delete('resource');

  const res = await fetch(`${COGNITO_HOSTED_UI_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const responseBody = await res.text();
  console.log('[token]', {
    grant_type: params.get('grant_type'),
    status: res.status,
    ...(res.ok ? {} : { body: responseBody }),
  });

  return {
    statusCode: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
    },
    body: responseBody,
  };
};
