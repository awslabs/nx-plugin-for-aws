/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const AC_DIR = 'packages/common/agent_connection/proj_agent_connection/core';
const LANGCHAIN_PATH = `${AC_DIR}/agentcore_a2a_client_langchain.py`;
const STRANDS_PATH = `${AC_DIR}/agentcore_a2a_client_strands.py`;
const WRAPPER_PATH =
  'packages/common/agent_connection/proj_agent_connection/app/snapshot_agent_client_strands.py';

const OLD_LANGCHAIN = `import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.types import Message, Part, Role, Task, TextPart

from .agentcore_a2a_client_config import AgentCoreA2aClientConfig


def _run_sync(coro):
    # The tool is invoked from sync agent code, which under uvicorn runs inside a
    # live event loop where asyncio.run() would raise — fall back to a worker.
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def _text(event) -> str:
    # Collect text parts from a bare Message or a (Task, update) event.
    parts = []
    if isinstance(event, Message):
        parts = event.parts
    elif isinstance(event, tuple):
        task, update = event
        if isinstance(task, Task) and task.artifacts:
            parts = [p for a in task.artifacts for p in (a.parts or [])]
        elif update is not None and getattr(update, "status", None) and update.status.message:
            parts = update.status.message.parts
    return "".join(p.root.text for p in parts if getattr(p.root, "text", None))


class _A2AClient:
    """A synchronously-callable A2A client. Sends a text prompt to the remote
    agent and returns its text reply. Built on the a2a SDK only — no Strands."""

    def __init__(self, url: str, client_config: ClientConfig):
        self._url = url
        self._config = client_config

    def __call__(self, prompt: str) -> str:
        return _run_sync(self._invoke(prompt))

    async def _invoke(self, prompt: str) -> str:
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
        return reply


class AgentCoreA2aClientLangChain:
    """Factory for A2A clients that connect to an AgentCore runtime.

    Reuses the framework-agnostic Layer-1 \`\`AgentCoreA2aClientConfig\`\` (signed
    \`\`a2a.client.ClientConfig\`\`) and drives the a2a SDK directly, so a LangChain
    agent delegating to an A2A agent pulls in no Strands dependency."""

    @staticmethod
    def with_iam_auth(agent_runtime_arn: str) -> _A2AClient:
        """SigV4-authenticated client for a Bedrock AgentCore runtime."""
        return _A2AClient(*AgentCoreA2aClientConfig.with_iam_auth(agent_runtime_arn))

    @staticmethod
    def with_jwt_auth(
        agent_runtime_arn: str, access_token_provider: Callable[[], str]
    ) -> _A2AClient:
        """Bearer-authenticated client for a Bedrock AgentCore runtime."""
        return _A2AClient(
            *AgentCoreA2aClientConfig.with_jwt_auth(
                agent_runtime_arn, access_token_provider
            )
        )

    @staticmethod
    def without_auth(url: str) -> _A2AClient:
        """Plain-HTTP client for local dev."""
        return _A2AClient(*AgentCoreA2aClientConfig.without_auth(url))
`;

const OLD_STRANDS = `from collections.abc import Callable

from strands.agent.a2a_agent import A2AAgent

from .agentcore_a2a_client_config import AgentCoreA2aClientConfig


def _build(
    config: tuple, *, name: str | None, description: str | None
) -> A2AAgent:
    url, client_config = config
    kwargs: dict = {"endpoint": url, "client_config": client_config}
    if name:
        kwargs["name"] = name
    if description:
        kwargs["description"] = description
    return A2AAgent(**kwargs)


class AgentCoreA2aClientStrands:
    """Factory for Strands A2A clients that connect to an AgentCore runtime."""

    @staticmethod
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
        )

    @staticmethod
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
        )

    @staticmethod
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
        )
`;

const OLD_WRAPPER = `import os

from strands.agent.a2a_agent import A2AAgent

from proj_agent_connection.core.agentcore_a2a_client_strands import (
    AgentCoreA2aClientStrands,
)
from proj_agent_connection.core.runtime_config import (
    get_agentcore_runtime_config,
)


class SnapshotAgentClientStrands:
    """Strands client for the SnapshotAgent A2A agent."""

    @staticmethod
    def create() -> A2AAgent:
        if os.environ.get("LOCAL_DEV") == "true":
            return AgentCoreA2aClientStrands.without_auth("http://localhost:9000/")
        config = get_agentcore_runtime_config()
        agent_runtime = config.get("agentRuntimes", {}).get("SnapshotAgent")
        agent_runtime_arn = agent_runtime.get("arn") if agent_runtime else None
        if not agent_runtime_arn:
            raise RuntimeError(
                "No connected agent runtime named 'SnapshotAgent' found in runtime configuration."
            )
        return AgentCoreA2aClientStrands.with_iam_auth(agent_runtime_arn)
`;

describe('py-agent-a2a-httpx-client-per-call migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no matching files exist', async () => {
    await expect(migration(tree)).resolves.toEqual({ nextSteps: [] });
  });

  describe('agentcore_a2a_client_langchain.py', () => {
    it('should rebuild a fresh httpx.AsyncClient per call', async () => {
      tree.write(LANGCHAIN_PATH, OLD_LANGCHAIN);

      const result = await migration(tree);
      const migrated = tree.read(LANGCHAIN_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).toContain('import httpx');
      expect(migrated).toContain('shared_client = self._config.httpx_client');
      expect(migrated).toContain('async with httpx.AsyncClient(');
      expect(migrated).toContain(
        'ClientConfig(httpx_client=httpx_client, streaming=False)',
      );
      expect(migrated).not.toContain(
        'httpx_client = self._config.httpx_client',
      );
      expect(migrated).not.toContain(
        'client = ClientFactory(self._config).create(card)',
      );
    });

    it('should report a diverged generated shape without partially rewriting it', async () => {
      const diverged = OLD_LANGCHAIN.replace(
        'raise RuntimeError("A2A client config is missing an httpx client")',
        'raise RuntimeError("custom message")',
      );
      tree.write(LANGCHAIN_PATH, diverged);

      const result = await migration(tree);
      const contents = tree.read(LANGCHAIN_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(LANGCHAIN_PATH);
      expect(contents).toContain('httpx_client = self._config.httpx_client');
      expect(contents).not.toContain('import httpx');
    });

    it('should be idempotent', async () => {
      tree.write(LANGCHAIN_PATH, OLD_LANGCHAIN);

      await migration(tree);
      const once = tree.read(LANGCHAIN_PATH, 'utf-8');
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(LANGCHAIN_PATH, 'utf-8')).toEqual(once);
    });
  });

  describe('agentcore_a2a_client_strands.py', () => {
    it('should rebuild a fresh httpx.AsyncClient and A2AAgent per call', async () => {
      tree.write(STRANDS_PATH, OLD_STRANDS);

      const result = await migration(tree);
      const migrated = tree.read(STRANDS_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).toContain('import httpx');
      expect(migrated).toContain(
        'from strands.agent.agent_result import AgentResult',
      );
      expect(migrated).toContain('class _A2AClient:');
      expect(migrated).toContain('def _run_sync(coro):');
      expect(migrated).toContain('async with httpx.AsyncClient(');
      expect(migrated).toContain('return await agent.invoke_async(prompt)');
      expect(migrated).toContain(') -> _A2AClient:');
      expect(migrated).not.toContain('-> A2AAgent:');
      expect(migrated).not.toContain('return A2AAgent(**kwargs)');
    });

    it('should report a diverged generated shape without partially rewriting it', async () => {
      const diverged = OLD_STRANDS.replace(
        '"""Plain-HTTP client — for local dev."""',
        '"""Custom docstring."""',
      );
      tree.write(STRANDS_PATH, diverged);

      const result = await migration(tree);
      const contents = tree.read(STRANDS_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(STRANDS_PATH);
      expect(contents).toContain('return A2AAgent(**kwargs)');
      expect(contents).not.toContain('class _A2AClient:');
    });

    it('should be idempotent', async () => {
      tree.write(STRANDS_PATH, OLD_STRANDS);

      await migration(tree);
      const once = tree.read(STRANDS_PATH, 'utf-8');
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(STRANDS_PATH, 'utf-8')).toEqual(once);
    });
  });

  describe('<target>_client_strands.py wrapper', () => {
    it('should drop the stale A2AAgent import and return annotation', async () => {
      tree.write(WRAPPER_PATH, OLD_WRAPPER);

      const result = await migration(tree);
      const migrated = tree.read(WRAPPER_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).toContain('def create():');
      expect(migrated).not.toContain('A2AAgent');
      // The rest of the body is untouched.
      expect(migrated).toContain(
        'return AgentCoreA2aClientStrands.without_auth("http://localhost:9000/")',
      );
      expect(migrated).toContain(
        'return AgentCoreA2aClientStrands.with_iam_auth(agent_runtime_arn)',
      );
    });

    it('should report a diverged generated shape without partially rewriting it', async () => {
      const diverged = OLD_WRAPPER.replace(
        'from strands.agent.a2a_agent import A2AAgent',
        'from strands.agent.a2a_agent import A2AAgent as StrandsA2AAgent',
      );
      tree.write(WRAPPER_PATH, diverged);

      const result = await migration(tree);
      const contents = tree.read(WRAPPER_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(WRAPPER_PATH);
      expect(contents).toContain('def create() -> A2AAgent:');
    });

    it('should be idempotent', async () => {
      tree.write(WRAPPER_PATH, OLD_WRAPPER);

      await migration(tree);
      const once = tree.read(WRAPPER_PATH, 'utf-8');
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(WRAPPER_PATH, 'utf-8')).toEqual(once);
    });

    it('should not touch a non-A2A strands wrapper (e.g. an MCP client)', async () => {
      const mcpWrapper = `from strands.tools.mcp import MCPClient


class SomeMcpClientStrands:
    @staticmethod
    def create() -> MCPClient:
        return MCPClient(lambda: None)
`;
      const mcpPath =
        'packages/common/agent_connection/proj_agent_connection/app/some_mcp_client_strands.py';
      tree.write(mcpPath, mcpWrapper);

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(mcpPath, 'utf-8')).toEqual(mcpWrapper);
    });
  });
});
