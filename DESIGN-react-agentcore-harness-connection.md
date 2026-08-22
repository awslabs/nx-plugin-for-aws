# Design: connecting a CopilotKit React website to a managed Bedrock AgentCore Harness

**Status:** Draft for review
**Author:** Walt Mayfield (waltmayf)
**Reviewers:** Jack Stevenson (jacsteve), Korey Tibbs (kotibbs)
**Tracking:** [Asana — Contribute AgentCore "connection generator"](https://app.asana.com/1/8442528107068/project/1209857823651872/task/1217563236020479)
**Related work:** Korey's `agentcore-harness` generator (released); this doc covers the *frontend* half — wiring a CopilotKit React website to a deployed Harness.
**Reference:** [Wiring CopilotKit to a Managed Bedrock AgentCore Harness](https://builder.aws.com/content/3GbKQ818IeQUpt9yHfsAQvXMpFF/wiring-copilotkit-to-a-managed-bedrock-agentcore-harness) (the client-side AG-UI adapter this generalises).

---

## 1. Context & motivation

In [the Slack thread](https://amzn-aws.slack.com/archives/C096H6QNW6M/p1784237852808559), Jack asked whether the CopilotKit → AgentCore approach from the builder.aws.com article could become first-class support in `@aws/nx-plugin`'s `connection` generator. The work was split:

- **Korey** — the `agentcore-harness` generator that scaffolds and deploys a managed Harness. **Done / released.**
- **This doc (Walt)** — `connection` generator support so a generated React website can drive a generated Harness and get a working CopilotKit chat UI.

The plan (confirmed with Jack): fork, raise a PR upstream.

### The open question Jack raised (the crux of this design)

> Giving a frontend direct access to `InvokeHarness` also grants it the ability to override the system prompt, allowed tools, actor id, etc. Not really viable without a proxy in between that strips those controls.

Jack is right, and the AgentCore Harness security guidance is explicit about why: the Harness validates the **structure** of an `InvokeHarness` request, not its **meaning**. Any principal that passes the inbound authorizer reaches the full configured toolset, and the request body can override the system prompt, the model configuration, the tool/skill set, and the actor identity. AWS's documented guidance for untrusted callers is to *"validate and sanitize messages in your application layer before passing them to InvokeHarness… stripping content-block types or model configuration fields."* ([harness-security.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-security.html))

**This design is built around that constraint, but the "proxy" is not a bespoke Lambda — it is the tRPC API the plugin already generates.** See §4.

---

## 2. Goals / non-goals

### Goals

- Let `pnpm nx g @aws/nx-plugin:connection` wire a generated React website to a generated Harness, producing a working CopilotKit chat UI.
- Interpose a **server-side application layer** that (a) authenticates the end user, (b) pins system-controlled invocation fields, (c) **converts the Harness's Converse-style stream into AG-UI server-side**, and (d) exposes it as a **standard AG-UI SSE endpoint on the plugin's existing API** so the browser renders it with stock CopilotKit primitives over a stock `@ag-ui/client` `HttpAgent`.
- Because the AG-UI translation is server-side, make the generated API a **drop-in AG-UI endpoint that a frontend the user already has can connect to** — any AG-UI client points at the API URL, with no plugin-specific client adapter or transport code.
- Make **AgentCore Memory the durable source of truth** for a conversation: a running turn survives dropped connections, page reloads, and cross-device check-in, because the Harness runs to completion server-side regardless of who is listening (§4.2).
- Support the two auth modes the website already supports: **Cognito** (JWT) and **IAM** (SigV4).
- Idempotent, snapshot-tested, matrix-tested, documented — meeting the repo's merge gates.

### Non-goals

- Changing Korey's `agentcore-harness` generator's public surface (we only *add* an invoke grant and a runtime-config publish to its construct via AST patch, exactly as the agent path does today).
- A general-purpose AgentCore Gateway integration for harnesses (the gateway fronts agent runtimes / MCP, not harnesses).
- *Generating* a non-React frontend. (The API speaks standard AG-UI, so any AG-UI client — React or not — can connect to it; the plugin only *scaffolds* the React/CopilotKit UI.)
- Any frontend that talks to `InvokeHarness` directly, bypassing the API (rejected — §4.1).
- **v1** targets turns bounded by the harness `timeoutSeconds` default (1 hour) delivered over streaming/polling. Multi-hour (async, up to 8h) turns are *enabled* by the poll-Memory model but depend on an async invocation kickoff not yet verified (§6, spike Q6).

---

## 3. How the relevant machinery works today

### 3.1 The `connection` generator dispatch

`packages/nx-plugin/src/connection/`:

- `generator.ts` — `connectionGenerator` calls `resolveConnection()`, which introspects both projects (`determineProjectTypeFromConfig`, ordered most-specific-first) and builds a `ConnectionKey` like `"ts#react-website -> ts#trpc-api"`. That key indexes `CONNECTION_GENERATORS`, an exhaustive map `satisfies Record<ConnectionKey, …>`.
- `supported-connections.ts` — the dependency-free source of truth: `SUPPORTED_PROJECT_TYPES` and `SUPPORTED_CONNECTIONS`. The `ConnectionKey` type is derived from `SUPPORTED_CONNECTIONS`, so **adding a connection is a compile error until both the matrix entry and the dispatch entry exist.**

`SUPPORTED_CONNECTIONS` already includes `{ source: 'ts#react-website', target: 'ts#trpc-api' }`. `agentcore-harness` is **absent** from both `SUPPORTED_PROJECT_TYPES` and `SUPPORTED_CONNECTIONS` — that is the gap this design fills.

### 3.2 The tRPC API generator already ships a full streaming-subscription stack

`packages/nx-plugin/src/trpc/backend/` supports `infra: 'rest-lambda' | 'http-lambda' | 'none'`, and the `rest-lambda` path is a complete server-sent-events subscription transport, end to end:

- **Handler** (`files/src/handler.ts.template`): for `infra === 'rest-lambda'` the handler is
  ```ts
  export const handler = awslambda.streamifyResponse(
    awsLambdaStreamingRequestHandler({
      router: appRouter,
      createContext: (ctx) => ctx, // raw Lambda event → procedures can read headers + JWT claims
      responseMeta: /* … */,
    }),
  );
  ```
  The buffered `awsLambdaRequestHandler` is used for `http-lambda` (no streaming).
- **Schema helper** (`files/src/schema/z-async-iterable.ts.template`): `ZodAsyncIterable({ yield, return?, tracked? })` validates async-iterable procedure outputs and supports `tracked()` envelopes for subscriptions. `generator.ts` deletes this file for any non-`rest-lambda` infra (lines ~301-306), so its presence is the signal that streaming is available.
- **API Gateway** (`utils/api-constructs/files/cdk/app/apis/rest/__apiNameKebabCase__.ts.template`): for `trpc`/`fastapi` backends the integration is created with `responseTransferMode: ResponseTransferMode.STREAM` (line 161). Default handler `timeout: Duration.seconds(30)` (line 146).
- **Client** (`trpc/react/files/src/components/__apiNameClassName__ClientProvider.tsx.template`): uses `splitLink` to route `op.type === 'subscription'` through `httpSubscriptionLink({ EventSource: EventSourcePolyfill })`, and everything else through `httpLink`.

So the plugin can already stand up a tRPC subscription that streams `tracked()` events to the browser over SSE, and a tRPC query/mutation for request-response — **without any new transport code.** The tRPC handler's `createContext: (ctx) => ctx` hands each procedure the raw Lambda event, so a procedure (and, equally, a sibling route) can read `event.headers.authorization` and the JWT authorizer claims server-side.

**What this design reuses from that stack, and what it doesn't.** The AG-UI route reuses the *streaming Lambda plumbing* — the `streamifyResponse` handler, the `ResponseTransferMode.STREAM` integration, the raw-event auth context, and CloudFront/CORS wiring. It does **not** reuse the *tRPC subscription wire protocol*: AG-UI has its own SSE contract that a stock AG-UI client expects (§4), so the AG-UI stream is emitted directly rather than through `httpSubscriptionLink`/`tracked()`. The `history` query, being a plain request-response read, remains an ordinary tRPC procedure.

### 3.3 The reusable CopilotKit helper — `addAgUiReactConnection`

`packages/nx-plugin/src/ts/react-website/agui/generator.ts` is the single place CopilotKit is wired into a website. It generates `AguiProvider.tsx` + a per-agent `useAgui<Name>.tsx` hook (both `KeepExisting`), vends a theme module from `metadata.ux`, generates the sigv4 hooks for `auth: 'iam'`, ensures `RuntimeConfig`, AST-patches the provider + `main.tsx` (all GritQL-guarded for idempotency), registers `@scarf/scarf: false`, and adds CopilotKit deps.

The generated hook builds an `@ag-ui/client` `HttpAgent` pointed at a URL. This works for an **agent runtime** because the agent's own container speaks AG-UI SSE at `/invocations`; `HttpAgent` expects an AG-UI event stream on the other end. **A Harness has no such endpoint** — it is invoked via the `InvokeHarness` data-plane API and emits Converse-style `contentBlockDelta` events, not AG-UI.

The fix in this design is not to change the browser transport but to **give the Harness the AG-UI endpoint it lacks, on the plugin's own API**: the API converts Converse → AG-UI server-side and re-exposes it as a standard AG-UI SSE endpoint (§4, §7.5). The website therefore keeps building a stock `HttpAgent` via `addAgUiReactConnection` — it is simply pointed at the API's AG-UI route instead of at a runtime `/invocations`. This is what lets a frontend the user already has connect too.

### 3.4 The Harness (Korey's work) — invocation model

`packages/nx-plugin/src/utils/agent-core-constructs/files/cdk/app/agentcore-harness/…`:

- The CDK construct creates a `CfnHarness` with a generated execution role, **IAM inbound auth** (comment, line 52), optional VPC, default model `global.anthropic.claude-sonnet-4-6`, and `systemPrompt` read from a file at synth time.
- It provisions **managed memory** by default and grants the execution role `CreateEvent`/`GetEvent`/`ListEvents`/`RetrieveMemoryRecords` on `attrMemoryManagedMemoryConfigurationArn` (lines 295-311).
- It publishes the ARN to the **`agentcore`** namespace: `rc.set('agentcore', 'harnesses', { <ClassName>: this.harness.attrArn })` — **not** the `connection` namespace a website reads.
- `grantInvokeAccess(grantee)` grants `bedrock-agentcore:InvokeHarness` + `InvokeAgentRuntime` on the harness ARN (lines 355-365).
- Invocation (from the generated `chat.ts` script) uses the **SDK**:
  ```ts
  const { stream } = await client.send(new InvokeHarnessCommand({
    harnessArn: HARNESS_ARN,
    runtimeSessionId: SESSION_ID,
    messages: [{ role: 'user', content: [{ text }] }],
  }));
  for await (const event of stream) {
    const chunk = event.contentBlockDelta?.delta?.text; // Converse-style, NOT AG-UI
    if (chunk) yield chunk;
  }
  ```

---

## 4. The core problem, and why the tRPC API is the answer

There are two mismatches between "what a CopilotKit website expects" and "what a Harness offers":

| | Agent runtime (works today) | Harness (this work) |
|---|---|---|
| **Browser transport** | Stock `HttpAgent` → runtime `/invocations`; container emits **AG-UI SSE**. | No AG-UI endpoint exists. Invoked via the `InvokeHarness` SDK API; emits Converse-style `contentBlockDelta`. |
| **Security** | Agent code fixed at deploy; caller supplies only messages. | `InvokeHarness` accepts per-invocation overrides — the request body can set `systemPrompt`, `model` (incl. `additionalParams`), `tools`, `allowedTools`, `skills`, `actorId`, `runtimeUserId`, etc. The Harness validates structure, not intent. |

Both are solved by putting the plugin's **API** (the generated tRPC-API project) between the browser and the Harness. The server layer *is* the application layer AWS's guidance calls for: it authenticates the user, pins every system-controlled field server-side, forwards **only** the user's messages to `InvokeHarness`, and — the change from the earlier draft — **translates the Harness's Converse-style stream into AG-UI on the server**, re-exposing it as a standard AG-UI SSE endpoint the browser (or any AG-UI client) can consume directly.

**Where the AG-UI translation lives, and why the API can't just reuse the tRPC subscription transport.** A stock `@ag-ui/client` `HttpAgent` `POST`s a `RunAgentInput` JSON body and reads a `text/event-stream` where each default `data:` record is one AG-UI `BaseEvent` JSON ([HttpAgent docs](https://docs.ag-ui.com/sdk/js/client/http-agent)). tRPC's `httpSubscriptionLink` is a *different* SSE contract: input arrives as `GET` query params, and the stream uses **named `event: data`** frames plus tRPC control frames (`connected`, `serialized-error`, ping comments) ([httpSubscriptionLink docs](https://trpc.io/docs/client/links/httpSubscriptionLink)). So even if a subscription procedure *yielded* AG-UI event JSON, a stock AG-UI client pointed at that URL could not parse it. To deliver a stream that any AG-UI client understands, the API exposes a **dedicated AG-UI SSE route** (e.g. `POST <api-url>/agui`) served by the same deployed API — same base URL, same authorizer, same CORS — rather than a tRPC procedure. The Converse → AG-UI mapping runs in that route's handler (§7.5).

This reframes the topology. Rather than a single `ts#react-website → agentcore-harness` connection that has to invent a bespoke proxy Lambda, the work decomposes into two connections, one of which already exists:

```
ts#react-website  ──(exists)──▶  ts#trpc-api  ──(new)──▶  agentcore-harness
   HttpAgent  ──AG-UI SSE──▶  /agui route  ──InvokeHarness──▶  Harness
                              └─ Converse→AG-UI here
```

- **`ts#react-website → ts#trpc-api`** — already supported. Gives the website its auth wiring (Cognito bearer / SigV4) and the API's base URL in runtime config.
- **`ts#trpc-api → agentcore-harness`** — **new** (this design). Adds the AG-UI SSE route (plus an optional `history` procedure) to the API, grants the API's Lambda `InvokeHarness`, publishes the harness ARN into the Lambda's runtime config, and bumps the handler timeout.

The CopilotKit UI in the website is then wired to a **stock `HttpAgent` pointed at the API's `/agui` route** — the same primitive the agent-runtime path uses today (§3.3). A frontend the user already has connects the same way, because the API speaks standard AG-UI.

### 4.1 Why not direct browser → `InvokeHarness`

Rejected. Even with IAM SigV4 from the browser, any user could:

- Override `systemPrompt`, `model`, `tools`/`allowedTools`, `skills` — the Harness validates structure only and will honour them.
- Exfiltrate credentials via `model.additionalParams` passthrough — e.g. LiteLLM `aws_bedrock_runtime_endpoint` (endpoint redirect), OpenAI `extra_headers` incl. `Authorization` (header injection), `aws_role_name` (IAM role assumption). ([harness-security.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-security.html))
- Spoof another user's `actorId` / `runtimeUserId`, reaching another user's memory scope.

It also requires shipping the AWS SDK + a hand-written data-plane client to the browser. This is exactly Jack's blocker. **Not offered, not even as an opt-in.**

### 4.2 Why poll-Memory is the primary model

The managed Harness runs a turn to completion server-side, decoupled from the caller — it does **not** stop when a caller stops consuming its stream:

> "After the Task state times out, the harness continues executing until it reaches its own configured timeout."
> **Note:** "Stopping an execution or the Task state does not stop the harness from continuing to run."
> — [connect-bedrockagentcore.html](https://docs.aws.amazon.com/step-functions/latest/dg/connect-bedrockagentcore.html)

And the Harness writes each message exchange to **AgentCore Memory synchronously** as it happens (short-term memory via `CreateEvent`, readable immediately via `ListEvents`/`GetEvent`; long-term records are extracted asynchronously and are *not* a live channel).

Together these mean: once a turn is kicked off, the browser does **not** need to hold a stream to get the result. It can poll Memory for the conversation's events and reconstruct the full state at any time — after a reload, on another device, or while checking in on a turn that is still running. Streaming becomes a **latency optimisation for the active turn**, not a correctness requirement.

The harness-vs-runtime feature grid confirms the supporting capabilities are available on the managed Harness with no custom code: per-user memory scoping (actor id) ✅, OAuth inbound ✅, IAM inbound ✅, streaming responses ✅. Bidirectional streaming is Runtime-only ❌. ([harness-vs-runtime.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-vs-runtime.html))

---

## 5. Design decision

### Chosen: server-side AG-UI translation, exposed as an **AG-UI SSE endpoint** on the generated API, **Memory-durable**

The browser talks to a **standard AG-UI SSE route on the generated API**. The API's Lambda is the application-layer boundary, the `InvokeHarness` caller, **and the Converse → AG-UI translator**. Any AG-UI client — the generated CopilotKit UI's stock `HttpAgent`, or a frontend the user already has — connects by pointing at the API URL.

The server surface is:

1. **`/agui` — the AG-UI run endpoint.** A dedicated SSE route (not a tRPC procedure — see §4 for why). It accepts an AG-UI `RunAgentInput` `POST`, reads **only** `messages` + `threadId` from it, and pins `harnessArn`, `systemPrompt`, `model`, `tools`, `allowedTools`, `skills` server-side; derives `actorId`/`runtimeUserId` from the validated JWT `sub`; derives `runtimeSessionId` from `threadId`. It calls `InvokeHarness`, maps each Converse `contentBlockDelta` to AG-UI events (`RUN_STARTED` / `TEXT_MESSAGE_*` / `RUN_FINISHED`, later `TOOL_CALL_*`), and writes them to the response as `text/event-stream`. Because the Harness runs to completion server-side (§4.2), the turn is durable even if the client disconnects.
2. *(optional)* **`history` — hydrate/reconstruct from Memory.** A tRPC query (or a second AG-UI-shaped GET) over `ListEvents` scoped to the caller's session + actor (again from the validated JWT), returning the conversation so far as AG-UI messages. This is the durable read path: reload, cross-device, and "check in on an in-progress turn" all use it. The generated frontend calls it on mount to hydrate a thread; a bring-your-own frontend may use it or ignore it.

Sketch of the AG-UI route handler (framework-neutral; runs inside the API's streaming Lambda):

```ts
// POST /agui — body is an AG-UI RunAgentInput; response is AG-UI SSE.
async function handleAgui(req, res, ctx) {
  const { messages, threadId, runId } = parseRunAgentInput(req.body);
  const sub = jwtSubFromContext(ctx);                   // validated, server-side
  const encoder = new EventEncoder();                   // @ag-ui/encoder → `data: {json}\n\n`
  res.write(encoder.encode({ type: 'RUN_STARTED', threadId, runId }));

  const { stream } = await client.send(new InvokeHarnessCommand({
    harnessArn: HARNESS_ARN,                            // pinned via env, from runtime config
    runtimeSessionId: sessionIdFor(sub, threadId),
    actorId: sub, runtimeUserId: sub,                   // from JWT, never the client
    messages: toConverseMessages(messages),             // the ONLY client-controlled field
  }));

  const messageId = newMessageId();
  res.write(encoder.encode({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' }));
  for await (const e of stream) {
    const text = e.contentBlockDelta?.delta?.text;       // Converse-style
    if (text) res.write(encoder.encode({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text }));
  }
  res.write(encoder.encode({ type: 'TEXT_MESSAGE_END', messageId }));
  res.write(encoder.encode({ type: 'RUN_FINISHED', threadId, runId }));
}
```

**Why this is the right fit:**

- **Solves both mismatches server-side** — the API is the protocol adapter *and* the security boundary. Converting to AG-UI on the server means the browser needs no plugin-specific transport or adapter code at all.
- **Bring-your-own-frontend** — because the API speaks standard AG-UI, an existing AG-UI/CopilotKit frontend connects by URL alone. This is the primary motivation for translating server-side rather than client-side.
- **Correctness-by-default** — the Harness runs to completion server-side and Memory is the durable source of truth (§4.2); a dropped SSE connection never loses a turn, and `history` reconstructs it.
- **Maximal reuse on the browser side** — the generated UI reuses `addAgUiReactConnection`'s provider/theme/registration wiring and its stock `HttpAgent`, unchanged except for the URL (the API's `/agui` route instead of a runtime `/invocations`). Auth reuses the website's existing Cognito/IAM setup and the API's authorizer.
- **The article thesis is preserved in spirit** — no CopilotKit Node runtime; the translation is one small pure function (Converse → AG-UI) living in the API handler (§7.5).

### Alternatives considered

1. **Direct browser `InvokeHarness` (IAM SigV4), no server layer** — rejected (§4.1); override + `additionalParams` exfil surface; ships the SDK to the browser.
2. **Client-side AG-UI translation (typed deltas on the wire, adapt in a bespoke `AbstractAgent`)** — the earlier draft's approach. Rejected here: it couples every consumer to a plugin-specific tRPC client and a hand-written AG-UI adapter, so a frontend the user already has cannot connect. Translating server-side makes the API a standard AG-UI endpoint instead.
3. **AG-UI events tunnelled through a tRPC subscription** — rejected: a stock AG-UI client cannot consume tRPC's SSE framing (§4), so it would still require a bespoke client, defeating the bring-your-own-frontend goal.
4. **A bespoke proxy Lambda behind a Function URL** — rejected in favour of adding the route to the generated API: it would duplicate auth, CORS, and runtime-config plumbing the API already provides.
5. **CopilotKit Node runtime (`@copilotkit/runtime`)** — heavier; introduces a server framework the repo deliberately avoids. **Rejected.**
6. **Route through the AgentCore Gateway** — the gateway fronts agent runtimes / MCP, not harnesses. **Not applicable.**

---

## 6. Constraints

The turn-length limits are layered across three distinct enforcement points. The tightest limits are **connection caps** (how long a caller may hold a request), not caps on the harness turn itself. Because the poll-Memory model doesn't hold the connection, those caps largely stop binding.

**1. Harness agent-loop bounds** (what actually stops the reasoning loop) — [harness-operations.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-operations.html):
- `timeoutSeconds` — wall-clock timeout for a single invocation. **Default 3600s (1h)**; configurable via `CreateHarness`/`UpdateHarness` or per-invocation.
- `maxIterations` — reasoning/action cycles. Default 75.
- `maxTokens` — token budget. Default none.

**2. AgentCore Runtime invocation quotas** (the harness is backed by Runtime, so it inherits these) — [bedrock-agentcore-limits.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html), **all non-adjustable**:

| Limit | Value | Scope |
|---|---|---|
| Request timeout | **15 min** | synchronous requests |
| Streaming maximum duration | **60 min** | response-streaming / WebSocket connections |
| Asynchronous job maximum duration | **8 hours** | async jobs |

**3. Session/instance lifetime** — [runtime-lifecycle-settings.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html): `maxLifetime` default 28800s (8h, microVMs), up to 1209600s (14 days, Instances).

Consequences for the design:
- The **`/agui` SSE route** is a streaming response, capped at 60 min; it cannot deliver a multi-hour turn while holding the connection.
- The harness runs the turn to completion server-side regardless (§4.2), writing to Memory as it goes — so `history`/`ListEvents` reconstructs a turn that outlives any connection cap. This is what makes turns up to `timeoutSeconds` (default 1h, raisable toward `maxLifetime`) usable from the browser.
- **Multi-hour (up to 8h) turns require an async invocation kickoff**, not the synchronous/streaming `InvokeHarness` path. The exact async mechanism is **not yet verified** — the Step Functions integration ([connect-bedrockagentcore.html](https://docs.aws.amazon.com/step-functions/latest/dg/connect-bedrockagentcore.html)) is Request-Response only. Flagged as a spike item (§12 Q6). v1 targets ≤1h turns.

Other constraints:
- **No bidirectional streaming** on the Harness (Runtime-only). Client→server is one message set per turn; server→client is the delta stream. ([harness-vs-runtime.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-vs-runtime.html))
- **Per-user identity does not propagate downstream under SigV4.** Per-user credential scoping (Token Vault / OBO), per-user Cedar/Gateway authorization require a **Bearer JWT inbound** (`customJWTAuthorizer` with `discoveryUrl` + `allowedClients`). The tRPC procedure can forward the user's JWT to `InvokeHarness` to preserve this when the Harness is configured for JWT inbound. Under IAM inbound, the procedure still enforces per-user scoping itself (actor id from JWT), but downstream tools see the Lambda's identity, not the user's. ([harness-security.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-security.html))
- **The Harness rejects `toolUse` blocks in the final message** server-side; the procedure forwards user text only.
- **Memory timeliness:** short-term events are readable immediately (`ListEvents`); long-term extracted records are eventually consistent and must not be treated as a live transcript.

There is also a separate constraint at the transport layer: a `rest-lambda`-fronted API is an **API Gateway REST API**, which imposes a **29-second integration timeout** independent of the Lambda's own timeout. See §7.4.

---

## 7. Generator design

### 7.1 Wiring into the `connection` generator

In `supported-connections.ts`:

```ts
export const SUPPORTED_PROJECT_TYPES = [ …, 'agentcore-gateway', 'agentcore-harness' ] as const;

export const SUPPORTED_CONNECTIONS = [
  …,
  { source: 'ts#react-website', target: 'ts#trpc-api' },        // already present
  { source: 'ts#trpc-api',      target: 'agentcore-harness' },  // NEW
] as const satisfies readonly Connection[];
```

In `connection/generator.ts`:

- Add a detection branch to `determineProjectTypeFromConfig` matching `metadata.generator === AGENTCORE_HARNESS_GENERATOR_INFO.id` (import the exported info from `agentcore-harness/generator.ts`), ordered before generic project types.
- Add the dispatch entry:
  ```ts
  'ts#trpc-api -> agentcore-harness': (tree, opts) =>
    trpcAgentCoreHarnessConnectionGenerator(tree, opts),
  ```

The website→harness experience is: run the connection generator once for `react-website → trpc-api` (existing) and once for `trpc-api → agentcore-harness` (new). The docs (§10) will spell out the two-step flow; a future convenience wrapper could chain them, but v1 keeps them as distinct, composable connections that mirror how the rest of the matrix works.

### 7.2 New sub-generator

Location: `packages/nx-plugin/src/agentcore-harness/trpc-connection/` (mirrors `agentcore-gateway/react-connection/` and `ts/agent/react-connection/`).

```
agentcore-harness/trpc-connection/
├── generator.ts          # trpcAgentCoreHarnessConnectionGenerator
├── schema.json / schema.d.ts
├── generator.spec.ts
├── files/agui/…          # AG-UI route handler + Converse→AG-UI mapper templates
├── files/procedures/…    # optional `history` tRPC procedure template
└── __snapshots__/
```

Responsibilities:

1. Read source (tRPC API) and target (harness) configs via `readProjectConfigurationUnqualified`; read harness metadata (`name`, `rc` class name, `auth`, `iac`) via `readAgentCoreHarnessMetadata`.
2. **AG-UI route:** generate the AG-UI SSE route handler (the `InvokeHarness` caller + Converse→AG-UI mapper) into the API project, and register it on the API Gateway as a streaming route (GritQL-guarded) — see §7.4 for the route-registration mechanism.
3. **History (optional):** generate a `history` procedure into the API's `src/procedures/` and register it in the router (GritQL-guarded), for Memory-backed hydration/reconstruction.
4. **Infra:** grant the API Lambda `InvokeHarness`, publish the harness ARN into the Lambda's runtime config, and raise the AG-UI handler timeout (§7.4).
5. Record `addComponentGeneratorMetadata` on the API so version-sync owns the added deps (`@aws-sdk/client-bedrock-agentcore`, `@ag-ui/core`/`@ag-ui/encoder`); call `addGeneratorMetricsIfApplicable`; `formatFilesInSubtree`; return an install callback.

The **website side** is handled by the existing `ts#react-website → ts#trpc-api` connection (which supplies auth + the API base URL) plus pointing `addAgUiReactConnection`'s stock `HttpAgent` at the `/agui` route (§7.3). Whether this generator or a small extension to `addAgUiReactConnection` wires that URL is Q1 (§12).

### 7.3 Frontend: a stock `HttpAgent` pointed at the API's AG-UI route

Because the API emits standard AG-UI SSE (§7.5), the browser needs **no plugin-specific agent or transport code**. CopilotKit drives a stock `@ag-ui/client` `HttpAgent` — the same primitive the agent-runtime path already generates via `addAgUiReactConnection` — configured with:

- **`url`** = the API's `/agui` route, read from the runtime config the `react-website → trpc-api` connection already publishes;
- **`requestInit`** carrying the auth the website already has — the Cognito bearer token or a SigV4-signed request — reusing the sigv4 hooks `addAgUiReactConnection` generates for `auth: 'iam'`. No new auth code is needed.

Thread hydration on mount and reconnect-after-drop are handled by the server-side `history` read path (§5) feeding the same thread; for the generated CopilotKit UI this is wired through the provider, and a bring-your-own frontend can call `history` or rely on its own AG-UI client's state. The run/message IDs are owned server-side (the `/agui` handler emits them), so there is a single source of identity — no client-side reconciliation of two divergent id spaces.

This reuses `addAgUiReactConnection`'s provider/theme/registration wiring essentially unchanged — the only harness-specific difference from the agent-runtime path is the URL it targets.

### 7.4 Infra: AG-UI route, grant, runtime-config publish, timeout

Add a `connection/harness-trpc-config.ts` (analogous to `agent-runtime-config.ts`) that patches the **harness** and **API** constructs:

1. **Register the AG-UI route.** The generated REST API is operation-driven — routes come from `routerToOperations(appRouter)` (`__apiNameKebabCase__.ts.template:118`), so the AG-UI endpoint is *not* a tRPC operation and needs a route added alongside them. The route serves the AG-UI handler with `ResponseTransferMode.STREAM` (matching the tRPC/fastapi streaming integration at `__apiNameKebabCase__.ts.template:161`) and inherits the API's authorizer + CORS aspect. **Confirm the cleanest registration mechanism (Q4)** — an addition to the construct's default integrations, a documented construct hook, or the connection generator patching the CDK app to attach an extra `LambdaIntegration` on a `/agui` resource.
2. On the API Lambda: `harness.grantInvokeAccess(apiFn)` and inject `HARNESS_ARN` (read from `rc.get('agentcore').harnesses.<ClassName>`) as an env var.
3. Raise the AG-UI handler's Lambda timeout. The REST API template hard-codes `timeout: Duration.seconds(30)` (`__apiNameKebabCase__.ts.template:146`); the AG-UI route needs a higher timeout (toward the 900s Lambda maximum) as a backstop for a long-running invocation. **Confirm the cleanest mechanism (Q4).**

   Note the Lambda timeout is *not* the binding limit for a REST-API-fronted route: an API Gateway **REST API caps the integration at 29s**, so a held SSE response cannot exceed that regardless of the Lambda timeout. This is why the durable read path is `history`/Memory polling — the `/agui` SSE stream delivers deltas within the window, and any turn that runs longer is reconstructed from Memory. The Lambda-timeout bump still matters so the invocation isn't killed mid-turn before the harness hands off to its own run-to-completion path. Confirm the exact SSE-vs-29s interaction during the spike (Q6).
4. If the Harness must see the user's identity for downstream per-user authz, configure JWT inbound on the harness and forward the bearer token (Q3) — otherwise IAM inbound with server-derived actor id is the default.
5. All edits GritQL-guarded (`not contains`) for idempotency; Terraform equivalents appended where the API's `iac` is `terraform`.

> **Design note for Korey:** these patches live entirely in the connection generator (agent-path style), needing no change to the harness generator's public surface. A first-class `grantInvoke`/`frontend` prop on the harness construct is a possible future refinement (Q1).

### 7.5 Where translation happens: Converse → AG-UI on the server

**The API's output contract is AG-UI itself.** The `/agui` route's handler normalizes the Harness's Converse-style stream (`contentBlockDelta`) into AG-UI events and writes them to the SSE response with the AG-UI encoder's `data: {json}\n\n` framing. `history` returns an AG-UI message array derived from `ListEvents`. Both paths produce AG-UI; the raw Converse shape and `@aws-sdk/client-bedrock-agentcore` never reach the browser.

Doing the translation server-side is the central decision of this revision. It is what makes the API a **standard AG-UI endpoint**, and it is deliberate:

- **Bring-your-own-frontend.** A frontend the user already has — any AG-UI/CopilotKit client — connects by pointing at the API URL. Nothing plugin-specific ships to the browser. This is the goal that drove moving translation off the client.
- **One id space, owned by the server.** The `/agui` handler mints the run/message IDs and is the single writer of both the live stream and (via `history`) the Memory reconstruction, so the two agree by construction. There is no client-side reconciliation of a live stream against a separately-id'd poll.
- **Client stays stock.** The browser uses an unmodified `@ag-ui/client` `HttpAgent` (§7.3); no bespoke `AbstractAgent`, no plugin-specific transport.

The tradeoff, accepted: the API is coupled to AG-UI as its wire format (rather than a framework-neutral typed shape), and the AG-UI endpoint lives outside the tRPC operation set, so it is registered as a dedicated route (§7.4) rather than falling out of `routerToOperations` for free. A non-CopilotKit consumer that wants raw data can still use the `history` procedure, which returns structured messages.

The handler explicitly **does not** read `systemPrompt`, `allowedTools`, `model`, `skills`, or `actorId` from the `RunAgentInput` — this is the control-stripping Jack asked for. Only `messages` + `threadId` are consumed; every other invocation field is pinned server-side or derived from the validated JWT.

### 7.6 Auth alignment & local dev

- **Auth** follows the API's authorizer, which follows the website. IAM ⇒ SigV4; Cognito ⇒ bearer JWT (which the handler can also forward to a JWT-inbound Harness). The harness metadata currently hardcodes `auth: 'iam'` (Q3).
- **Local dev:** the API's existing `serve`/dev target runs the router — and the AG-UI route — locally; the handler calls the real deployed Harness via the developer's AWS creds. No separate dev proxy is needed — this is a further win over the bespoke-Lambda approach.

---

## 8. Security model (what the AG-UI route handler enforces)

The handler reads only `messages` + `threadId` from the incoming `RunAgentInput`; every other invocation field is pinned server-side or derived from the validated JWT.

| Threat (direct-invoke) | Handler mitigation |
|---|---|
| Override system prompt | Not read from `RunAgentInput`; Harness uses its deployed default. |
| Enable arbitrary tools / skills | `tools`/`allowedTools`/`skills` never forwarded; deploy-time config governs. |
| Model override / cost abuse / `additionalParams` exfil | `model` never forwarded. |
| Spoof another user's `actorId` | Derived server-side from the validated JWT `sub`. |
| Hijack / guess another session | `runtimeSessionId` from `threadId`; namespace by `sub` to prevent cross-user guessing (Q2). `history` reads are scoped to the caller's actor+session. |
| Unauthenticated access | The API's existing authorizer (IAM / Cognito / custom) applied to the `/agui` route. |

Under **IAM inbound** the handler enforces per-user scoping but downstream tools see the Lambda's identity. Under **JWT inbound** the handler can forward the user's bearer token so AgentCore Identity / Gateway / Cedar can scope per user (§6).

---

## 9. Idempotency

All file generation uses `OverwriteStrategy.KeepExisting`; all edits to existing files (the API's CDK app / route registration, the tRPC router for `history`, harness CDK/TF construct, runtime-config) use GritQL with `where { $program <: not contains … }` guards so re-running the connection is byte-identical. This matches the existing agui / agent-runtime-config patterns.

---

## 10. File-by-file change list

**New:**
- `packages/nx-plugin/src/agentcore-harness/trpc-connection/{generator.ts,schema.json,schema.d.ts,generator.spec.ts}`
- `packages/nx-plugin/src/agentcore-harness/trpc-connection/files/agui/{handler,converse-to-agui}.ts.template` — AG-UI SSE route handler + Converse→AG-UI mapper
- `packages/nx-plugin/src/agentcore-harness/trpc-connection/files/procedures/history.ts.template` — optional Memory-backed hydration
- `packages/nx-plugin/src/connection/harness-trpc-config.ts` (AG-UI route registration + grant + runtime-config publish + timeout patch)
- `docs/src/content/docs/en/guides/connection/trpc-agentcore-harness.mdx` (+ localized copies), documenting the two-step website→trpc-api→harness flow **and how to point an existing AG-UI frontend at the API's `/agui` URL**

**Modified:**
- `packages/nx-plugin/src/connection/supported-connections.ts` — add `agentcore-harness` project type + the `ts#trpc-api → agentcore-harness` connection
- `packages/nx-plugin/src/connection/generator.ts` — detection branch + dispatch entry
- `packages/nx-plugin/src/ts/react-website/agui/generator.ts` — point the stock `HttpAgent` at the API's `/agui` URL for this connection (Q1)
- `packages/nx-plugin/generators.json` — register the sub-generator (factory, schema, `metric` id, `hidden` where appropriate) and add the guide page to the `connection` entry's `guidePages`
- The AG-UI route registration + handler timeout mechanism in the REST API construct (Q4)

---

## 11. Testing plan

Per CONTRIBUTING (Vitest, snapshot-of-generated-tree, in-memory Nx `Tree`):

- **Snapshot tests** in `agentcore-harness/trpc-connection/generator.spec.ts` — assert the generated AG-UI handler + route registration + optional `history` procedure + grant/runtime-config patches, across iam/cognito auth and the API's `iac` (cdk/terraform).
- **Converse→AG-UI mapper unit test** — feed representative `contentBlockDelta` sequences to the pure mapper and assert the emitted AG-UI event sequence (`RUN_STARTED` → `TEXT_MESSAGE_*` → `RUN_FINISHED`), decoupled from generation.
- **Idempotency test** — run twice; assert no diff (mirrors the agui provider-merge guards).
- **`connection/generator.spec.ts`** — extend to cover dispatch/detection of the new pair.
- **E2E matrix** — the new entry flows automatically from `supported-connections.ts` into the connection matrix (`scaffold-catalog` / `internal/test-matrix`). Confirm it appears in **both** matrices.
- **Build/typecheck** — the `satisfies Record<ConnectionKey,…>` guarantees the dispatch map compiles only when complete.

---

## 12. Open questions / decisions to confirm

1. **Frontend URL wiring ownership:** since the browser uses a stock `HttpAgent` (no bespoke adapter), the only frontend work is pointing that `HttpAgent` at the API's `/agui` URL from runtime config. Does the new trpc-connection generator do that wiring, or is it a small parameterization of `addAgUiReactConnection` (which already builds the `HttpAgent` for the agent-runtime path)?

   **Recommendation:** reuse `addAgUiReactConnection` — it already builds the `HttpAgent`; this connection only needs to supply the `/agui` URL and the existing auth `requestInit`. Moving translation server-side removes the earlier draft's bespoke client agent entirely, so there is no separate adapter to own.

2. **Session isolation:** namespace `runtimeSessionId` / Memory reads by authenticated `sub` to prevent cross-user session guessing.

   **Recommendation:** yes — derive the session/actor scope from the validated JWT `sub` server-side; never accept an unscoped `threadId` as the sole session key.

3. **Harness `auth` field & JWT forwarding:** the harness metadata hardcodes `auth: 'iam'`. Decide whether to support JWT inbound + bearer forwarding (needed for per-user downstream authz) in v1 or defer.

   **Decided (Milestone 4): defer.** The harness metadata keeps `auth: 'iam'`; the Harness is never invoked with a forwarded bearer token. Cognito support in Milestone 4 is scoped entirely to the **website ⇄ API leg**: when the `ts#trpc-api` is generated with `auth: 'cognito'`, the browser presents a bearer JWT to the API's `/agui` route and `history` procedure (inherited from the API's own Cognito authorizer, §7.6), and `actorIdFromEvent` (`agentcore-harness/trpc-connection/files/agui/session.ts.template`) derives the AgentCore Memory actor id from the validated JWT `sub` claim instead of the (absent, under Cognito) IAM principal ARN. The bearer JWT terminates at the API/Lambda handler — the handler still invokes the Harness via its own IAM execution role (`InvokeHarnessCommand` over the AWS SDK, unrelated to the caller's auth mode), with per-user scoping enforced by the handler as already shipped in Milestones 2–3. No Harness-side JWT-inbound configuration or bearer-forwarding code was added; no concrete blocker requiring it was found. Revisit as a follow-up only when a concrete use case needs per-user downstream (Token Vault / Gateway / Cedar) authorization.

4. **AG-UI route registration + handler timeout:** the AG-UI endpoint is not a tRPC operation, so it needs a route added to the operation-driven REST API (`__apiNameKebabCase__.ts.template:118`) with `ResponseTransferMode.STREAM` and a raised timeout (the template hard-codes 30s at `:146`). Cleanest mechanism — extend the construct's default integrations, add a documented construct hook, or have the connection generator patch the CDK app to attach a `LambdaIntegration` on a `/agui` resource. This is the largest new unknown introduced by translating server-side, and should be prototyped in the spike.

   **Recommendation:** prototype in the spike; prefer a connection-generator patch that attaches the extra route + integration (agent-path style, no harness/API public-surface change), falling back to a documented construct hook if route-injection proves brittle. Treat the raised timeout as a backstop only — the binding limit is the REST API's 29s integration cap (§7.4), so correctness rests on Memory polling.

5. **Tool-call rendering:** does the `InvokeHarness` stream expose tool-call events worth translating to AG-UI `TOOL_CALL_*`, or is v1 assistant-text-only? Needs a spike against a deployed Harness.

   **Recommendation:** v1 emits assistant text only (`TEXT_MESSAGE_*`). Layer AG-UI `TOOL_CALL_*` into the server-side mapper in a follow-up once the spike confirms the stream shape — an additive change to the mapper, no wire-contract break since the wire is already AG-UI.

6. **Long-turn / async kickoff & caller-abandon behaviour (spike):**
   - §4.2 is established for the Step Functions Request-Response path; confirm empirically that a *streaming* `InvokeHarness` caller abandoning the stream triggers the same run-to-completion. (The Note strongly implies it.)
   - Confirm the exact **async invocation mechanism** for turns that must outlive the 15-min synchronous / 60-min streaming connection caps (the 8h "asynchronous job" quota). The Step Functions integration is Request-Response only, so this is a distinct path. Determines whether multi-hour turns are in scope beyond v1.
   - Confirm how the `/agui` SSE response interacts with the API Gateway REST **29s integration timeout** (§7.4) — i.e. how many delta seconds actually reach the browser before the client must fall back to `history` polling.

   **Recommendation:** scope v1 to turns bounded by `timeoutSeconds` (≤1h), delivered via streaming + Memory polling; treat multi-hour async kickoff as out of scope pending the spike. Run the spike before MVP so the caller-abandon and 29s-streaming behaviours are confirmed, not assumed.

7. **Article alignment:** §5/§7.5 derive the event mapping from the repo's existing AG-UI code; confirm it matches the adapter in the builder.aws.com article.

   **Recommendation:** proceed with the repo-derived mapping; treat the article as a cross-check, not a blocker. Reconcile any divergence during the spike.

---

## 13. Milestones

1. **Spike** — deploy a Harness (Korey's generator) + a hand-written AG-UI SSE route on a generated API; confirm the server-side Converse→AG-UI stream renders in a **stock `HttpAgent`/CopilotKit** client (and that a bring-your-own AG-UI client connects by URL), that `history`/`ListEvents` reconstructs a turn after a dropped connection, how long the SSE response survives against the REST 29s integration cap, how cleanly the AG-UI route can be attached to the operation-driven REST API (Q4), and whether/how a turn can be kicked off async to outlive the connection caps. Resolves Q4/Q5/Q6/Q7.
2. **Generator MVP** — matrix + dispatch + AG-UI route handler (Converse→AG-UI mapper) + route registration + optional `history` procedure + grant + runtime-config publish + timeout bump; iam auth; snapshot + idempotency tests.
3. **Frontend + Memory** — point the stock `HttpAgent` at the `/agui` URL via `addAgUiReactConnection`; wire `history` hydration on mount/reconnect.
4. **Cognito auth + JWT forwarding + docs + matrix** — resolve Q3; `trpc-agentcore-harness.mdx` (incl. bring-your-own-frontend URL), `guidePages`, both e2e matrices.
5. **E2E validation** — fresh workspace with locally-compiled plugin; `build` + `dev`; deploy to AWS, verify, tear down (per CLAUDE.md).
6. **PR** — conventional commit `feat(connection): trpc-api → agentcore-harness`, PR template, monitor checks.
