/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Rebuild the `httpx.AsyncClient` (and, for Strands, the `A2AAgent`) fresh on
 * every A2A delegate call, instead of reusing the one built once at factory
 * time - fixes a reproducible `RuntimeError: Event loop is closed` on the
 * second call through a shared client.
 *
 * Both frameworks' A2A clients call out through a synchronous wrapper
 * (`_run_sync`) that runs the async call via `asyncio.run(...)` - a brand new
 * event loop per call, closed when the call returns. `AgentCoreA2aClientConfig`
 * builds one `httpx.AsyncClient` a single time, at factory call time, and that
 * client's connection pool binds to whichever event loop first touches it. So
 * call #1 creates a loop, uses the shared client, closes the loop; call #2
 * creates a *new* loop, but the shared client's pool is still bound to the
 * old, now-closed one.
 *
 * Strands hits the same failure one layer down: `A2AAgent.__call__` is itself
 * synchronous and does its own `asyncio.run(...)` per call internally, while
 * reusing the same factory-built `httpx.AsyncClient` via `client_config`.
 *
 * The fix in both `AgentCoreA2aClientLangChain`/`AgentCoreA2aClientStrands` is
 * to stop handing out a client wired to one long-lived `httpx.AsyncClient`.
 * Instead each call opens a fresh `httpx.AsyncClient` (reusing only the
 * `auth`/`timeout` off the once-built shared config) scoped to that call via
 * `async with`, so its connection pool lives and dies with the same loop that
 * created it. For Strands this also means `AgentCoreA2aClientStrands`'s
 * factories no longer return a raw `A2AAgent` (dropped in favour of a private
 * `_A2AClient` built per call), so the per-target `<Agent>ClientStrands.create`
 * wrapper's `-> A2AAgent` return annotation and its now-unused `A2AAgent`
 * import go stale too.
 */
const pyMatch = (snippet: string) => `language python\n\`${snippet}\``;

const pyRewrite = (from: string, to: string): string => {
  const replacement = to.includes('\n') ? `raw\`${to}\`` : `\`${to}\``;
  return `${pyMatch(from)} => ${replacement}`;
};

const allMatch = async (
  tree: Tree,
  filePath: string,
  patterns: string[],
): Promise<boolean> => {
  for (const pattern of patterns) {
    if (!(await matchGritQL(tree, filePath, pattern))) return false;
  }
  return true;
};

// --- agentcore_a2a_client_langchain.py (framework-agnostic core, shared) ---

const LANGCHAIN_IMPORT_OLD =
  'from a2a.client import A2ACardResolver, ClientConfig, ClientFactory';
const LANGCHAIN_IMPORT_NEW = `import httpx
from a2a.client import A2ACardResolver, ClientConfig, ClientFactory`;

const LANGCHAIN_INVOKE_OLD = `    async def _invoke(self, prompt: str) -> str:
        # AgentCoreA2aClientConfig always sets the signed httpx client.
        httpx_client = self._config.httpx_client
        if httpx_client is None:
            raise RuntimeError("A2A client config is missing an httpx client")
        card = await A2ACardResolver(
            httpx_client=httpx_client, base_url=self._url
        ).get_agent_card()
        client = ClientFactory(self._config).create(card)
        message = Message(
            kind="message",
            role=Role.user,
            message_id=uuid4().hex,
            parts=[Part(TextPart(kind="text", text=prompt))],
        )
        # The client config uses streaming=False, so the last event carries the
        # complete response.
        reply = ""
        async for event in client.send_message(message):
            text = _text(event)
            if text:
                reply = text
        return reply`;

const LANGCHAIN_INVOKE_NEW = `async def _invoke(self, prompt: str) -> str:
    # AgentCoreA2aClientConfig always sets the signed httpx client.
    shared_client = self._config.httpx_client
    if shared_client is None:
        raise RuntimeError("A2A client config is missing an httpx client")
    async with httpx.AsyncClient(
        auth=shared_client.auth, timeout=shared_client.timeout
    ) as httpx_client:
        card = await A2ACardResolver(
            httpx_client=httpx_client, base_url=self._url
        ).get_agent_card()
        client = ClientFactory(
            ClientConfig(httpx_client=httpx_client, streaming=False)
        ).create(card)
        message = Message(
            kind="message",
            role=Role.user,
            message_id=uuid4().hex,
            parts=[Part(TextPart(kind="text", text=prompt))],
        )
        # The client config uses streaming=False, so the last event carries
        # the complete response.
        reply = ""
        async for event in client.send_message(message):
            text = _text(event)
            if text:
                reply = text
        return reply`;

const migrateLangchainCoreClient = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  const contents = tree.read(filePath, 'utf-8') ?? '';
  if (!contents.includes('client = ClientFactory(self._config).create(card)'))
    return;

  const ready = await allMatch(tree, filePath, [
    pyMatch(LANGCHAIN_IMPORT_OLD),
    pyMatch(LANGCHAIN_INVOKE_OLD),
  ]);

  if (!ready) {
    nextSteps.push(
      `${filePath}: diverged from the generated shape - left untouched. Manually rebuild a fresh httpx.AsyncClient per call in _invoke instead of reusing the one built at factory time (see the agent-connection generator's agentcore_a2a_client_langchain.py template).`,
    );
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    pyRewrite(LANGCHAIN_IMPORT_OLD, LANGCHAIN_IMPORT_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite(LANGCHAIN_INVOKE_OLD, LANGCHAIN_INVOKE_NEW),
  );
};

// --- agentcore_a2a_client_strands.py (Strands core client) ------------------

const STRANDS_IMPORT1_OLD = 'from collections.abc import Callable';
const STRANDS_IMPORT1_NEW = `import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor`;

const STRANDS_IMPORT2_OLD = 'from strands.agent.a2a_agent import A2AAgent';
const STRANDS_IMPORT2_NEW = `import httpx
from a2a.client import ClientConfig
from strands.agent.a2a_agent import A2AAgent
from strands.agent.agent_result import AgentResult`;

const STRANDS_BUILD_OLD = `def _build(
    config: tuple, *, name: str | None, description: str | None
) -> A2AAgent:
    url, client_config = config
    kwargs: dict = {"endpoint": url, "client_config": client_config}
    if name:
        kwargs["name"] = name
    if description:
        kwargs["description"] = description
    return A2AAgent(**kwargs)`;

const STRANDS_BUILD_NEW = `def _run_sync(coro):
    # The tool is invoked from sync agent code, which under uvicorn runs inside a
    # live event loop where asyncio.run() would raise — fall back to a worker.
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


class _A2AClient:
    def __init__(
        self,
        url: str,
        client_config: ClientConfig,
        *,
        name: str | None,
        description: str | None,
    ):
        shared_client = client_config.httpx_client
        if shared_client is None:
            raise RuntimeError("A2A client config is missing an httpx client")
        self._url = url
        self._auth = shared_client.auth
        self._timeout = shared_client.timeout
        self._name = name
        self._description = description

    def __call__(self, prompt: str) -> AgentResult:
        return _run_sync(self._invoke(prompt))

    async def _invoke(self, prompt: str) -> AgentResult:
        async with httpx.AsyncClient(
            auth=self._auth, timeout=self._timeout
        ) as httpx_client:
            agent = A2AAgent(
                endpoint=self._url,
                name=self._name,
                description=self._description,
                client_config=ClientConfig(httpx_client=httpx_client, streaming=False),
            )
            return await agent.invoke_async(prompt)


def _build(
    config: tuple, *, name: str | None, description: str | None
) -> _A2AClient:
    url, client_config = config
    return _A2AClient(url, client_config, name=name, description=description)`;

const STRANDS_IAM_OLD = `    @staticmethod
    def with_iam_auth(
        agent_runtime_arn: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> A2AAgent:
        """SigV4-authenticated client for a Bedrock AgentCore runtime."""
        return _build(
            AgentCoreA2aClientConfig.with_iam_auth(agent_runtime_arn),
            name=name,
            description=description,
        )`;

const STRANDS_IAM_NEW = `@staticmethod
def with_iam_auth(
    agent_runtime_arn: str,
    *,
    name: str | None = None,
    description: str | None = None,
) -> _A2AClient:
    """SigV4-authenticated client for a Bedrock AgentCore runtime."""
    return _build(
        AgentCoreA2aClientConfig.with_iam_auth(agent_runtime_arn),
        name=name,
        description=description,
    )`;

const STRANDS_JWT_OLD = `    @staticmethod
    def with_jwt_auth(
        agent_runtime_arn: str,
        access_token_provider: Callable[[], str],
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> A2AAgent:
        """Bearer-authenticated client for a Bedrock AgentCore runtime."""
        return _build(
            AgentCoreA2aClientConfig.with_jwt_auth(
                agent_runtime_arn, access_token_provider
            ),
            name=name,
            description=description,
        )`;

const STRANDS_JWT_NEW = `@staticmethod
def with_jwt_auth(
    agent_runtime_arn: str,
    access_token_provider: Callable[[], str],
    *,
    name: str | None = None,
    description: str | None = None,
) -> _A2AClient:
    """Bearer-authenticated client for a Bedrock AgentCore runtime."""
    return _build(
        AgentCoreA2aClientConfig.with_jwt_auth(
            agent_runtime_arn, access_token_provider
        ),
        name=name,
        description=description,
    )`;

const STRANDS_NOAUTH_OLD = `    @staticmethod
    def without_auth(
        url: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> A2AAgent:
        """Plain-HTTP client — for local dev."""
        return _build(
            AgentCoreA2aClientConfig.without_auth(url),
            name=name,
            description=description,
        )`;

const STRANDS_NOAUTH_NEW = `@staticmethod
def without_auth(
    url: str,
    *,
    name: str | None = None,
    description: str | None = None,
) -> _A2AClient:
    """Plain-HTTP client — for local dev."""
    return _build(
        AgentCoreA2aClientConfig.without_auth(url),
        name=name,
        description=description,
    )`;

const migrateStrandsCoreClient = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  const contents = tree.read(filePath, 'utf-8') ?? '';
  if (!contents.includes('return A2AAgent(**kwargs)')) return;

  const ready = await allMatch(tree, filePath, [
    pyMatch(STRANDS_IMPORT1_OLD),
    pyMatch(STRANDS_IMPORT2_OLD),
    pyMatch(STRANDS_BUILD_OLD),
    pyMatch(STRANDS_IAM_OLD),
    pyMatch(STRANDS_JWT_OLD),
    pyMatch(STRANDS_NOAUTH_OLD),
  ]);

  if (!ready) {
    nextSteps.push(
      `${filePath}: diverged from the generated shape - left untouched. Manually rebuild a fresh httpx.AsyncClient (and A2AAgent) per call instead of reusing the ones built at factory time (see the agent-connection generator's agentcore_a2a_client_strands.py template).`,
    );
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    pyRewrite(STRANDS_IMPORT1_OLD, STRANDS_IMPORT1_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite(STRANDS_IMPORT2_OLD, STRANDS_IMPORT2_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite(STRANDS_BUILD_OLD, STRANDS_BUILD_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite(STRANDS_IAM_OLD, STRANDS_IAM_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite(STRANDS_JWT_OLD, STRANDS_JWT_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite(STRANDS_NOAUTH_OLD, STRANDS_NOAUTH_NEW),
  );
};

// --- <target>_client_strands.py (per-target wrapper, one per connection) ---

const WRAPPER_IMPORT_OLD = 'from strands.agent.a2a_agent import A2AAgent';

const WRAPPER_CREATE_OLD = 'def create() -> A2AAgent:\n    $body';
const WRAPPER_CREATE_NEW = 'def create():\n    $body';

const migrateStrandsWrapperClient = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  const contents = tree.read(filePath, 'utf-8') ?? '';
  if (!contents.includes('def create() -> A2AAgent:')) return;

  const ready = await allMatch(tree, filePath, [
    pyMatch(WRAPPER_IMPORT_OLD),
    pyMatch(WRAPPER_CREATE_OLD),
  ]);

  if (!ready) {
    nextSteps.push(
      `${filePath}: diverged from the generated shape - left untouched. Manually drop the A2AAgent import and its -> A2AAgent return annotation on create() (see the py#agent#a2a-connection generator's per-target client_strands.py template).`,
    );
    return;
  }

  await applyGritQL(tree, filePath, `${pyMatch(WRAPPER_IMPORT_OLD)} => .`);
  await applyGritQL(
    tree,
    filePath,
    pyRewrite(WRAPPER_CREATE_OLD, WRAPPER_CREATE_NEW),
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  const filePaths: string[] = [];
  visitNotIgnoredFiles(tree, '', (filePath) => filePaths.push(filePath));

  for (const filePath of filePaths) {
    if (filePath.endsWith('/agentcore_a2a_client_langchain.py')) {
      await migrateLangchainCoreClient(tree, filePath, nextSteps);
    } else if (filePath.endsWith('/agentcore_a2a_client_strands.py')) {
      await migrateStrandsCoreClient(tree, filePath, nextSteps);
    } else if (filePath.endsWith('_client_strands.py')) {
      await migrateStrandsWrapperClient(tree, filePath, nextSteps);
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
