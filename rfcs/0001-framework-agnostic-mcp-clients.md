# RFC: Framework-agnostic MCP and Gateway clients

- Status: Draft
- Date: 2026-06-19
- Affects generators: `ts#agent#mcp-connection`, `ts#agent#gateway-connection`, `py#agent#mcp-connection`, `py#agent#gateway-connection`, and the shared `utils/agent-connection`

## Summary

The MCP clients generated for connecting agents to **MCP servers** and to **AgentCore
Gateways** are currently tied to the [Strands Agents](https://strandsagents.com) SDK. For
each connection we generate a core client that ends in a single Strands-specific line:

```ts
// TypeScript — core-mcp/agentcore-mcp-client.ts
return new McpClient({ transport });
```

```python
# Python — py-core-mcp/agentcore_mcp_client.py
return MCPClient(lambda: streamablehttp_client(url, auth=..., ...))
```

Everything else in these files — ARN/URL resolution from runtime config, SigV4 request
signing, JWT bearer auth, plain-HTTP local dev, and AgentCore session-header forwarding —
is framework-agnostic AWS/MCP plumbing.

This RFC proposes splitting these clients into layers so that the framework-specific code is
isolated to a thin top layer, the shared AWS/MCP code can be reused by other agent
frameworks (LangChain, CrewAI, the Claude Agent SDK, …), and adding a new framework is an
additive change rather than a fork.

## Motivation

We currently support only Strands. As we add support for other agent frameworks we must not
duplicate the genuinely hard and security-sensitive parts of these clients — SigV4 signing,
ARN→URL construction, runtime-config resolution, and AgentCore session propagation — once
per framework. Today a second framework would mean copying ~120 lines of auth/runtime code
and changing one line at the end.

## Background: how the clients work today

Three layers already exist implicitly, but the bottom two are fused into one file per
connection type.

### Runtime-config resolution (already generic)

`runtime-config.ts` / `runtime_config.py` reads the `agentcore` namespace from AppConfig
using the `RUNTIME_CONFIG_APP_ID` environment variable (set on the AgentCore runtime by the
generated CDK/Terraform construct) and returns:

```jsonc
{
  "agentRuntimes": { "MyMcpServer": "arn:aws:bedrock-agentcore:..." },
  "gateways":      { "MyGateway":   "https://<id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp" }
}
```

This module has **zero framework dependency** and is unchanged by this RFC.

### Per-connection client (resolves which endpoint)

Generated per connection, e.g. `MyMcpServerClient.create()`:

1. branch on `SERVE_LOCAL=true` → local plain-HTTP URL,
2. otherwise call `getAgentCoreRuntimeConfig()` and select the ARN/URL by construct class name,
3. hand the ARN/URL to the core client.

The only Strands reference here is the **return type** (`McpClient` / `MCPClient`).

### Core client (builds auth + transport, wraps in Strands)

Builds the invocation URL from the ARN, constructs the SigV4 signer (`aws4fetch` in TS /
`botocore` `SigV4Auth` via `httpx.Auth` in Python), forwards the
`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header from async context, creates the MCP
`StreamableHTTPClientTransport` / `streamablehttp_client`, and finally wraps it in the
Strands client. Only the final wrap is framework-specific.

### How agents consume the client

- **Strands TypeScript**: the `McpClient` is added directly to the Agent's `tools: [...]`
  array. The Agent framework drives `listTools()`/`callTool()` internally.
- **Strands Python**: the `MCPClient` is used as a context manager and its
  `list_tools_sync()` is spread into `Agent(tools=[...])`.

## Key finding: the transport is the right seam for Strands, but the *signer* is the
portable primitive

We verified the "share a configured transport, wrap per framework" idea against the agent
SDKs we expect to support next. The result is an asymmetry that shapes the design: different
frameworks accept an MCP connection at **different layers**, and the only piece every
framework can reuse is the **SigV4 request signer** plus the ARN/URL resolution — not the
transport object itself.

| Framework | Python | TypeScript | Layer it consumes |
|---|---|---|---|
| **Strands** (today) | wraps a transport **factory**: `MCPClient(lambda: transport())` | wraps a **transport**: `new McpClient({ transport })` | transport |
| **LangChain** | accepts `auth=httpx.Auth` / `httpx_client_factory` in connection config, or a pre-built `ClientSession` via `load_mcp_tools` | **no per-request hook** — only `{ url, static headers, OAuth authProvider }`; must bypass `@langchain/mcp-adapters` and drive the MCP `Client` directly | **signer** (Py) / none usable (TS) |
| **CrewAI** | forwards kwargs to `streamablehttp_client`, so `auth=` / `httpx_client_factory=` works (requires `mcp` SDK ≥ ~1.10) | n/a (Python-first) | **signer** |
| **Claude Agent SDK** | HTTP config is `url` + static headers only | HTTP config is `url` + static headers only | only via an **in-process SDK MCP server** adapter (you make the signed calls inside a tool handler) |

Why SigV4 forces this: SigV4 is **not** a static header. It signs each request from its
method, URL, headers, and body using AWS credentials, so it requires a per-request hook — a
custom `fetch` (TS) or an `httpx.Auth` (Python). A framework that only accepts
`{ url, headers }` can carry a static JWT bearer token but **cannot** carry SigV4.

Consequences:

- **LangChain-Python and CrewAI** never want our transport; they build their own and just
  need our SigV4 signer. So the signer must be reusable on its own.
- **LangChain-TS and the Claude Agent SDK (both languages)** expose no per-request signing
  hook on their HTTP transport. Supporting them is **not** a thin wrapper — it means either
  bypassing the adapter to drive the MCP `Client` ourselves, or building an in-process MCP
  server adapter whose tool handlers make the signed calls. The architecture should make this
  *possible* (by exposing the signer and a ready-built transport) without pretending it is a
  one-liner everywhere.

## Proposed design

Bottom out the shared code at the **signer + runtime-config/endpoint resolution**, with the
transport as the next layer, and the framework client as a thin top layer. Each framework
taps in at whichever layer it supports.

```
Layer 0  runtime-config + endpoint resolver   (generic)        getAgentCoreRuntimeConfig; SERVE_LOCAL branch; pick ARN/URL by name
Layer 0  SigV4 signer + session-header forward (generic)        the most portable primitive: fetch wrapper (TS) / httpx.Auth (Python)
Layer 1  transport builder                     (generic, MCP SDK only)  StreamableHTTPClientTransport / streamablehttp_client factory
Layer 2  framework adapter                      (per framework, thin)    new McpClient({transport}) / MCPClient(lambda: transport())
```

Within Layer 1 there is a further split: the MCP and gateway transports differ only in how
they derive `{ region, url }` from their identifier (ARN parsing vs. gateway-URL parsing).
The auth-mode → transport mapping (SigV4 / JWT / plain) is identical and is shared, so each
transport class reduces to a single `resolve()` function plus thin delegations to the shared
core. See the appendices for the full reference implementation.

### File layout (TypeScript, `core-*` directories)

```
core-runtime-config/runtime-config.ts            (unchanged)  Layer 0 — getAgentCoreRuntimeConfig
core-runtime-config/session-context.ts           (unchanged)  Layer 0 — async-context session id
core-auth/agentcore-fetch.ts                     NEW  Layer 0 — createSigV4Fetch / createJwtFetch / createPlainFetch (each forwards the session header)
core-transport/agentcore-transport.ts            NEW  Layer 1 shared — sigV4Transport / jwtTransport / noAuthTransport (endpoint-agnostic)
core-mcp/agentcore-mcp-transport.ts              NEW  Layer 1 — resolve ARN → { region, url }, delegate to shared core
core-mcp/agentcore-mcp-client.ts                 KEEP Layer 2 — thin: new McpClient({ transport })
core-gateway/agentcore-gateway-mcp-transport.ts  NEW  Layer 1 — resolve gateway URL → region, delegate to shared core
core-gateway/agentcore-gateway-mcp-client.ts     KEEP Layer 2 — thin Strands wrapper
```

### File layout (Python, `py-core-*` directories) — structurally equivalent

```
core-runtime-config/runtime_config.py            (unchanged)  Layer 0 — get_agentcore_runtime_config
core-runtime-config/session_context.py           (unchanged)  Layer 0 — async-context session id
core-auth/auth/sigv4.py                           (unchanged)  Layer 0 — SigV4HTTPXAuth
core-auth/auth/session.py                        NEW  Layer 0 — SessionHeaderAuth + sigv4_auth / jwt_auth / plain_auth builders (each forwards the session header)
core-transport/agentcore_transport.py            NEW  Layer 1 shared — sigv4_transport / jwt_transport / no_auth_transport (return a transport factory)
core-mcp/agentcore_mcp_transport.py              NEW  Layer 1 — resolve ARN → (region, url), delegate to shared core
core-mcp/agentcore_mcp_client.py                 KEEP Layer 2 — thin: MCPClient(<factory>)
core-gateway/agentcore_gateway_mcp_transport.py  NEW  Layer 1 — resolve gateway URL → region, delegate to shared core
core-gateway/agentcore_gateway_mcp_client.py     KEEP Layer 2 — thin Strands wrapper
```

The languages are equivalent layer-for-layer. The only intrinsic difference is the auth
mechanism the seam carries: TypeScript wraps a `fetch` (and the session header is set inside
that wrapper before signing), while Python wraps an `httpx.Auth` (the session header is
stamped by a `SessionHeaderAuth` wrapper that delegates to the inner SigV4/JWT auth). The
`SessionHeaderAuth` wrapper — today **duplicated** in both Python client files — moves into
the shared Layer-0 `auth/session.py`. Because Strands Python wraps a transport *factory*
(`MCPClient(lambda: streamablehttp_client(...))`), the Python Layer-1 functions return that
factory callable, mirroring the TS functions that return a `StreamableHTTPClientTransport`.

### Per-connection client and agent wiring

- The per-connection `create()` keeps the `SERVE_LOCAL` branch and ARN/URL selection, but
  these are framework-agnostic and should call a generic resolver (Layer 0) so the resolution
  is shared. Only the final framework wrap differs by framework.
- The agent AST wiring (`addTypeScriptClientToAgent` / `addPythonClientToAgent`) stays
  Strands-shaped for now, because the agent file *is* Strands. When a second framework lands,
  the wiring becomes framework-conditional, selecting the matching Layer-2 client and
  injection style.

### Dependency isolation

Only the Layer-2 files import `@strands-agents/sdk` / `strands-agents`. Layers 0 and 1 depend
solely on `@modelcontextprotocol/sdk` / `mcp`, `aws4fetch` / `botocore`, the AWS SDK, and
`@aws-lambda-powertools/parameters`. `with-session-id.ts` (the Strands `Agent` session-cache
wrapper) stays in the framework layer.

## Adding a new framework after this RFC

- **LangChain-Python / CrewAI**: new Layer-2 file consuming the **Layer-0 signer** directly
  (passes our `httpx.Auth` via `auth=` / `httpx_client_factory`), skipping Layer 1.
- **LangChain-TS / Claude Agent SDK**: new Layer-2 file that drives the MCP `Client` itself
  using Layers 0–1 (or an in-process SDK MCP server adapter). No thin wrapper is possible;
  this is documented as a known constraint of those SDKs.

## What this RFC does not change

- The runtime-config / ARN resolution module and the AppConfig contract.
- The AgentCore session-header name and propagation semantics.
- The A2A connection client. A2A is more tightly coupled (`strands.agent.a2a_agent.A2AAgent`
  returns an Agent, not a transport) and is out of scope; it should be treated separately.
- Generated CDK/Terraform constructs and the `SERVE_LOCAL` local-dev workflow.

## Open questions

1. Do we want the Layer-0 signer published as part of the generated `agent-connection`
   project's public surface, or kept internal until a second framework actually lands?
2. For TypeScript LangChain / Claude SDK support, do we prefer the "drive the MCP `Client`
   ourselves" path or the "in-process SDK MCP server adapter" path? They have different
   ergonomics for tool listing and lifecycle.
3. Should framework selection be a generator option (e.g. `--framework=strands|langchain`) on
   the agent generator, propagated to the connection generators, or inferred from the agent
   project?

## Rollout

1. Land the Layer 0/1/2 split for Strands MCP + gateway in both languages (no behavior
   change; snapshots update for the new file layout).
2. Document the layering and the per-framework constraints.
3. Add a second framework as a follow-up, validating that only a Layer-2 file (plus
   conditional agent wiring) is required.

## Appendix A: TypeScript reference implementation

### Layer 0 — `core-auth/agentcore-fetch.ts`

```ts
import { AwsClient } from 'aws4fetch';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { getCurrentSessionId } from '../core-runtime-config/session-context.js';

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

export interface SigV4FetchOptions {
  region: string;
  service?: string;
  credentialProvider?: ReturnType<typeof fromNodeProviderChain>;
}

/** A fetch that signs every request with AWS SigV4 (per-request, body-aware). */
export const createSigV4Fetch = (options: SigV4FetchOptions): typeof fetch => {
  const { region, service = 'bedrock-agentcore' } = options;
  const credentialProvider =
    options.credentialProvider ?? fromNodeProviderChain();
  const signedFetch: typeof fetch = async (input, init) => {
    const client = new AwsClient({ ...(await credentialProvider()), service, region });
    return client.fetch(input as RequestInfo, init);
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
```

### Layer 1 shared — `core-transport/agentcore-transport.ts`

```ts
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
  createSigV4Fetch,
  createJwtFetch,
  createPlainFetch,
} from '../core-auth/agentcore-fetch.js';

const build = (url: string, fetchFn: typeof fetch): StreamableHTTPClientTransport =>
  new StreamableHTTPClientTransport(new URL(url), { fetch: fetchFn });

/** SigV4-signed transport for a resolved AgentCore endpoint. */
export const sigV4Transport = (o: {
  region: string;
  url: string;
  credentialProvider?: ReturnType<typeof fromNodeProviderChain>;
}): StreamableHTTPClientTransport =>
  build(o.url, createSigV4Fetch({ region: o.region, credentialProvider: o.credentialProvider }));

/** Bearer-token transport for a resolved AgentCore endpoint. */
export const jwtTransport = (o: {
  url: string;
  accessTokenProvider: () => Promise<string>;
}): StreamableHTTPClientTransport => build(o.url, createJwtFetch(o.accessTokenProvider));

/** Plain-HTTP transport (local dev). */
export const noAuthTransport = (o: { url: string }): StreamableHTTPClientTransport =>
  build(o.url, createPlainFetch());
```

### Layer 1 — `core-mcp/agentcore-mcp-transport.ts`

```ts
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
  sigV4Transport,
  jwtTransport,
  noAuthTransport,
} from '../core-transport/agentcore-transport.js';

/** Build the invocation URL + region from an AgentCore runtime ARN. */
const resolve = (agentRuntimeArn: string): { region: string; url: string } => {
  const region = agentRuntimeArn.split(':')[3];
  const url = `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodeURIComponent(agentRuntimeArn)}/invocations?qualifier=DEFAULT`;
  return { region, url };
};

export class AgentCoreMcpTransport {
  static withIamAuth(o: {
    agentRuntimeArn: string;
    credentialProvider?: ReturnType<typeof fromNodeProviderChain>;
  }): StreamableHTTPClientTransport {
    return sigV4Transport({ ...resolve(o.agentRuntimeArn), credentialProvider: o.credentialProvider });
  }
  static withJwtAuth(o: {
    agentRuntimeArn: string;
    accessTokenProvider: () => Promise<string>;
  }): StreamableHTTPClientTransport {
    return jwtTransport({ url: resolve(o.agentRuntimeArn).url, accessTokenProvider: o.accessTokenProvider });
  }
  static withoutAuth(o: { url: string }): StreamableHTTPClientTransport {
    return noAuthTransport(o);
  }
}
```

### Layer 1 — `core-gateway/agentcore-gateway-mcp-transport.ts`

```ts
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { sigV4Transport, noAuthTransport } from '../core-transport/agentcore-transport.js';

const resolveRegion = (gatewayUrl: string): string => {
  const match = /\.bedrock-agentcore\.([^.]+)\.amazonaws\.com/.exec(gatewayUrl);
  if (!match) {
    throw new Error(`Cannot determine region from gateway URL '${gatewayUrl}'. Pass region explicitly.`);
  }
  return match[1];
};

export class AgentCoreGatewayMcpTransport {
  static withIamAuth(o: {
    gatewayUrl: string;
    region?: string;
    credentialProvider?: ReturnType<typeof fromNodeProviderChain>;
  }): StreamableHTTPClientTransport {
    return sigV4Transport({
      region: o.region ?? resolveRegion(o.gatewayUrl),
      url: o.gatewayUrl,
      credentialProvider: o.credentialProvider,
    });
  }
  static withoutAuth(o: { gatewayUrl: string }): StreamableHTTPClientTransport {
    return noAuthTransport({ url: o.gatewayUrl });
  }
}
```

### Layer 2 — `core-mcp/agentcore-mcp-client.ts` (only file importing Strands)

```ts
import { McpClient } from '@strands-agents/sdk';
import {
  AgentCoreMcpTransport,
  AgentCoreMcpTransportIamOptions,
  AgentCoreMcpTransportJwtOptions,
  AgentCoreMcpTransportNoAuthOptions,
} from './agentcore-mcp-transport.js';

export class AgentCoreMcpClient {
  static withIamAuth(o: AgentCoreMcpTransportIamOptions): McpClient {
    return new McpClient({ transport: AgentCoreMcpTransport.withIamAuth(o) });
  }
  static withJwtAuth(o: AgentCoreMcpTransportJwtOptions): McpClient {
    return new McpClient({ transport: AgentCoreMcpTransport.withJwtAuth(o) });
  }
  static withoutAuth(o: AgentCoreMcpTransportNoAuthOptions): McpClient {
    return new McpClient({ transport: AgentCoreMcpTransport.withoutAuth(o) });
  }
}
```

`core-gateway/agentcore-gateway-mcp-client.ts` is the same shape, delegating to
`AgentCoreGatewayMcpTransport`.

## Appendix B: Python reference implementation (equivalent)

### Layer 0 — `core-auth/auth/session.py`

```python
from collections.abc import Callable

import httpx

from .sigv4 import SigV4HTTPXAuth
from ..core_runtime_config.session_context import get_current_session_id

SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"


class SessionHeaderAuth(httpx.Auth):
    """Stamps the AgentCore session header from the current async context,
    then delegates to an optional inner auth (e.g. SigV4)."""

    requires_request_body = True
    requires_response_body = True

    def __init__(self, inner: httpx.Auth | None = None):
        self._inner = inner

    def auth_flow(self, request: httpx.Request):  # type: ignore[override]
        sid = get_current_session_id()
        if sid:
            request.headers[SESSION_HEADER] = sid
        if self._inner is None:
            yield request
            return
        yield from self._inner.auth_flow(request)


def sigv4_auth(credentials, region: str, service: str = "bedrock-agentcore") -> httpx.Auth:
    """Session-forwarding SigV4 auth (per-request, body-aware)."""
    return SessionHeaderAuth(SigV4HTTPXAuth(credentials, service, region))


def jwt_auth(access_token_provider: Callable[[], str]) -> httpx.Auth:
    """Session-forwarding bearer-token auth."""

    class _Bearer(httpx.Auth):
        def auth_flow(self, request: httpx.Request):
            request.headers["Authorization"] = f"Bearer {access_token_provider()}"
            yield request

    return SessionHeaderAuth(_Bearer())


def plain_auth() -> httpx.Auth:
    """Session-forwarding plain auth (local dev)."""
    return SessionHeaderAuth()
```

### Layer 1 shared — `core-transport/agentcore_transport.py`

```python
from collections.abc import Callable

import boto3
import httpx
from mcp.client.streamable_http import streamablehttp_client

from ..core_auth.auth.session import sigv4_auth, jwt_auth, plain_auth

# Strands wraps a transport *factory*, so each builder returns a no-arg callable.
TransportFactory = Callable[[], object]


def _factory(url: str, auth: httpx.Auth) -> TransportFactory:
    return lambda: streamablehttp_client(
        url, auth=auth, timeout=120, terminate_on_close=False
    )


def sigv4_transport(url: str, region: str) -> TransportFactory:
    """SigV4-signed transport factory for a resolved AgentCore endpoint."""
    credentials = boto3.Session(region_name=region).get_credentials()
    return _factory(url, sigv4_auth(credentials, region))


def jwt_transport(url: str, access_token_provider: Callable[[], str]) -> TransportFactory:
    """Bearer-token transport factory for a resolved AgentCore endpoint."""
    return _factory(url, jwt_auth(access_token_provider))


def no_auth_transport(url: str) -> TransportFactory:
    """Plain-HTTP transport factory (local dev)."""
    return _factory(url, plain_auth())
```

### Layer 1 — `core-mcp/agentcore_mcp_transport.py`

```python
from collections.abc import Callable

from ..core_transport.agentcore_transport import (
    sigv4_transport,
    jwt_transport,
    no_auth_transport,
    TransportFactory,
)


def _resolve(agent_runtime_arn: str) -> tuple[str, str]:
    """Extract region from ARN and construct the invocation URL.

    ARN format: arn:partition:service:region:account-id:resource
    """
    region = agent_runtime_arn.split(":")[3]
    encoded_arn = agent_runtime_arn.replace(":", "%3A").replace("/", "%2F")
    url = (
        f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/"
        f"{encoded_arn}/invocations?qualifier=DEFAULT"
    )
    return region, url


class AgentCoreMcpTransport:
    @staticmethod
    def with_iam_auth(agent_runtime_arn: str) -> TransportFactory:
        region, url = _resolve(agent_runtime_arn)
        return sigv4_transport(url, region)

    @staticmethod
    def with_jwt_auth(
        agent_runtime_arn: str, access_token_provider: Callable[[], str]
    ) -> TransportFactory:
        _, url = _resolve(agent_runtime_arn)
        return jwt_transport(url, access_token_provider)

    @staticmethod
    def without_auth(url: str) -> TransportFactory:
        return no_auth_transport(url)
```

### Layer 1 — `core-gateway/agentcore_gateway_mcp_transport.py`

```python
import re

from ..core_transport.agentcore_transport import (
    sigv4_transport,
    no_auth_transport,
    TransportFactory,
)


def _resolve_region(gateway_url: str) -> str:
    match = re.search(r"\.bedrock-agentcore\.([^.]+)\.amazonaws\.com", gateway_url)
    if not match:
        raise ValueError(
            f"Cannot determine region from gateway URL '{gateway_url}'. "
            "Pass region explicitly."
        )
    return match.group(1)


class AgentCoreGatewayMcpTransport:
    @staticmethod
    def with_iam_auth(gateway_url: str, region: str | None = None) -> TransportFactory:
        return sigv4_transport(gateway_url, region or _resolve_region(gateway_url))

    @staticmethod
    def without_auth(gateway_url: str) -> TransportFactory:
        return no_auth_transport(gateway_url)
```

### Layer 2 — `core-mcp/agentcore_mcp_client.py` (only file importing Strands)

```python
from collections.abc import Callable

from strands.tools.mcp.mcp_client import MCPClient

from .agentcore_mcp_transport import AgentCoreMcpTransport


class AgentCoreMCPClient:
    @staticmethod
    def with_iam_auth(agent_runtime_arn: str) -> MCPClient:
        return MCPClient(AgentCoreMcpTransport.with_iam_auth(agent_runtime_arn))

    @staticmethod
    def with_jwt_auth(
        agent_runtime_arn: str, access_token_provider: Callable[[], str]
    ) -> MCPClient:
        return MCPClient(
            AgentCoreMcpTransport.with_jwt_auth(agent_runtime_arn, access_token_provider)
        )

    @staticmethod
    def without_auth(url: str) -> MCPClient:
        return MCPClient(AgentCoreMcpTransport.without_auth(url))
```

`core-gateway/agentcore_gateway_mcp_client.py` is the same shape, delegating to
`AgentCoreGatewayMcpTransport`.

## Appendix C: Adding a non-Strands framework (TypeScript)

LangChain-TS and the Claude Agent SDK expose no per-request signing hook on their HTTP MCP
transport, so they skip Layer 2 and drive the MCP `Client` themselves using the shared
Layers 0–1:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { AgentCoreMcpTransport } from '../core/agentcore-mcp-transport.js';

const client = new Client({ name: 'agent', version: '1.0.0' });
await client.connect(AgentCoreMcpTransport.withIamAuth({ agentRuntimeArn }));
const { tools } = await client.listTools();
// → adapt `tools` to the target framework's tool type here
```

This demonstrates the payoff: a new framework reuses all signing / URL / session code and
adds only a new Layer-2 file (or direct Layer-1 use), with no duplication.
