"""Invoke-smoke-test for the generated LangChain Layer-2 MCP / gateway clients.

This is NOT a generated template (no ``.template`` suffix, so the nx generators
ignore it). It is a standalone proof that the client templates under
``py-core-langchain/{mcp,gateway}`` produce tools that can actually be INVOKED
after construction — the gap that let the closed-session bug through (the
generator specs only assert template string content, never invoke a tool).

It renders the relevant ``*.template`` files into a temporary ``core`` package
mirroring the flat layout the connection generators emit, stands up a trivial
in-process streamable-HTTP MCP server exposing one ``echo`` tool, points the
generated ``without_auth`` client at it (so no SigV4 / AWS credentials are
needed), loads the tools through the generated client, then invokes one and
asserts it returns rather than raising ``ClosedResourceError`` on a closed
session.

Run it (it self-provisions its deps via uv):

    uv run --python 3.12 \
      --with mcp --with "langchain-mcp-adapters==0.3.0" \
      --with langchain-core --with uvicorn --with botocore --with boto3 \
      python langchain-client-invoke-smoke-test.py

The matching negative control (the old ``load_mcp_tools(session)`` shape RAISES
at invoke) is documented in the engagement notes; this script asserts the FIXED
path returns.
"""

import asyncio
import importlib.util
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

# Map each generated core file to the template that produces it (flat layout,
# exactly as the mcp-/gateway-connection generators emit into <module>/core/).
# This script lives in the repo-root scripts/ dir (NOT under src/, so the
# package assets glob does not ship it); the templates are under the plugin src.
TEMPLATES_ROOT = (
    Path(__file__).resolve().parent.parent
    / "packages/nx-plugin/src/utils/agent-connection/files"
)
CORE_FILES = {
    "session_context.py": "py-core-runtime-config/session_context.py.template",
    "auth/__init__.py": "py-core-auth/auth/__init__.py.template",
    "auth/session.py": "py-core-auth/auth/session.py.template",
    "auth/sigv4.py": "py-core-auth/auth/sigv4.py.template",
    "agentcore_endpoints.py": "py-core-auth/agentcore_endpoints.py.template",
    "agentcore_transport.py": "py-core-shared/agentcore_transport.py.template",
    "agentcore_mcp_transport.py": "py-core-mcp/agentcore_mcp_transport.py.template",
    "agentcore_gateway_mcp_transport.py": (
        "py-core-gateway/agentcore_gateway_mcp_transport.py.template"
    ),
    "agentcore_mcp_client_langchain.py": (
        "py-core-langchain/mcp/agentcore_mcp_client_langchain.py.template"
    ),
    "agentcore_gateway_mcp_client_langchain.py": (
        "py-core-langchain/gateway/agentcore_gateway_mcp_client_langchain.py.template"
    ),
}


def render_core_package(dest: Path) -> None:
    """Render the templates (verbatim — these core files carry no EJS tags) into
    a ``core`` package under *dest*, mirroring the generated flat layout."""
    core = dest / "core"
    (core / "auth").mkdir(parents=True)
    (core / "__init__.py").write_text("")
    for rel, template in CORE_FILES.items():
        content = (TEMPLATES_ROOT / template).read_text()
        assert "<%" not in content, f"{template} carries unrendered EJS tags"
        (core / rel).write_text(content)


def import_client(dest: Path, module: str, symbol: str):
    sys.path.insert(0, str(dest))
    spec = importlib.util.spec_from_file_location(
        f"core.{module}", dest / "core" / f"{module}.py"
    )
    mod = importlib.util.module_from_spec(spec)
    # Register the package so relative imports inside the module resolve.
    import core  # noqa: F401  (the rendered package)

    spec.loader.exec_module(mod)
    return getattr(mod, symbol)


def build_server_app(port: int):
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("stub", host="127.0.0.1", port=port, stateless_http=True)

    @mcp.tool()
    def echo(text: str) -> str:
        """Echo the input back."""
        return f"echoed:{text}"

    return mcp.streamable_http_app()


def run_server(app, port: int, ready: threading.Event) -> None:
    import uvicorn

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )

    async def serve():
        ready.set()
        await server.serve()

    asyncio.run(serve())


def exercise(client_cls, url: str, label: str) -> None:
    # The generated client loads tools at (sync) construction time.
    tools = client_cls.without_auth(url)
    names = [t.name for t in tools]
    assert "echo" in names, f"{label}: echo tool missing, got {names}"
    echo_tool = next(t for t in tools if t.name == "echo")

    # INVOKE after construction. Under the closed-session bug this raised
    # ClosedResourceError; with the MultiServerMCPClient config-dict path each
    # tool opens a fresh session per call, so it must return.
    result = asyncio.run(echo_tool.ainvoke({"text": "hello"}))
    assert "echoed:hello" in str(result), f"{label}: unexpected result {result!r}"
    print(f"{label}: loaded {names}, invoke returned {result!r} -> PASS")


def main() -> int:
    dest = Path(tempfile.mkdtemp(prefix="lc-mcp-smoke-"))
    try:
        render_core_package(dest)
        mcp_client = import_client(
            dest,
            "agentcore_mcp_client_langchain",
            "AgentCoreMCPClientLangChain",
        )
        gw_client = import_client(
            dest,
            "agentcore_gateway_mcp_client_langchain",
            "AgentCoreGatewayMCPClientLangChain",
        )

        port = 38231
        ready = threading.Event()
        t = threading.Thread(
            target=run_server, args=(build_server_app(port), port, ready), daemon=True
        )
        t.start()
        ready.wait(timeout=10)
        time.sleep(1.5)
        url = f"http://127.0.0.1:{port}/mcp"

        exercise(mcp_client, url, "mcp")
        exercise(gw_client, url, "gateway")
        print("SMOKE PASS")
        return 0
    finally:
        shutil.rmtree(dest, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
