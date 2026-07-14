import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const proxyUrl = `https://${event.requestContext.domainName}`;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: `${proxyUrl}/mcp`,
      authorization_servers: [proxyUrl],
    }),
  };
};
