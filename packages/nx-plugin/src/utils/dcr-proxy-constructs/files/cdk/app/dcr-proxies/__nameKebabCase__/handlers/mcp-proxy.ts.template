import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

const UPSTREAM_URL = process.env.UPSTREAM_URL!;
const PROXY_METADATA_URL = process.env.PROXY_METADATA_URL!;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
  'host',
]);

export const handler: APIGatewayProxyHandlerV2 = async (
  event,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const url = `${UPSTREAM_URL}${qs}`;

  const fwdHeaders = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    if (!v) continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    fwdHeaders.set(k, v);
  }

  const reqBody = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body
    : undefined;

  const upstream = await fetch(url, {
    method,
    headers: fwdHeaders,
    body: reqBody as unknown as ArrayBuffer | string | undefined,
  });

  const respHeaders: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    if (HOP_BY_HOP.has(k.toLowerCase())) return;
    respHeaders[k] = v;
  });

  // Rewrite WWW-Authenticate so MCP clients discover this proxy
  // as the protected-resource metadata host instead of the upstream.
  const authKey = Object.keys(respHeaders).find(
    (k) => k.toLowerCase() === 'www-authenticate',
  );
  if (authKey) {
    respHeaders[authKey] = respHeaders[authKey].replace(
      /resource_metadata="[^"]*"/i,
      `resource_metadata="${PROXY_METADATA_URL}"`,
    );
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  const contentType = (
    respHeaders['content-type'] ??
    respHeaders['Content-Type'] ??
    ''
  ).toLowerCase();
  const isText =
    contentType.includes('json') ||
    contentType.includes('text') ||
    contentType.includes('xml') ||
    contentType.includes('event-stream');

  return {
    statusCode: upstream.status,
    headers: respHeaders,
    body: isText ? buf.toString('utf-8') : buf.toString('base64'),
    isBase64Encoded: !isText,
  };
};
