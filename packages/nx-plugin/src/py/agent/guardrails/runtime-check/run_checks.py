# 
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
# 
"""Run a generated, guarded Python agent against fake_aws.py and report what
the real SDK sent. Used by guardrail-runtime.spec.ts.

Usage: python run_checks.py <project root> <connection root> <fake_aws.py> <framework>
    <agent package> <agent-connection module> [<scenario>]

<project root> holds the agent project's module and pyproject.toml, and
<connection root> the agent-connection module, as in a workspace.
Without a scenario, every scenario runs in a fresh interpreter (so the
guardrail cache and warn-once state start clean), then the static checks, and
one line "RESULTS <json>" maps each name to its result.
"""

import asyncio
import importlib
import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from typing import Any

ROOT, CONNECTION_ROOT, FAKE_AWS, FRAMEWORK, AGENT_PACKAGE, CONNECTION_MODULE = sys.argv[1:7]

ENTRY = {"guardrailId": "grtest", "guardrailVersion": "1"}
# fake_aws.py blocks a guarded request whose checked text contains "stocks".
BLOCKED_PROMPT = "Which stocks should I buy this year?"

# scenario: (LOCAL_DEV, RUNTIME_CONFIG_APP_ID, guardrail entry or None, number of calls)
SCENARIOS: dict[str, tuple[bool, str | None, dict[str, str] | None, int]] = {
    "guarded": (False, "fake-app", ENTRY, 1),
    "missing": (False, "fake-app", None, 1),
    "no-app-id": (False, None, ENTRY, 1),
    "local-dev": (True, None, ENTRY, 2),
    "local-dev-broken": (True, "broken", ENTRY, 2),
    "local-dev-guarded": (True, "fake-app", ENTRY, 1),
    "draft": (False, "fake-app", {**ENTRY, "guardrailVersion": "DRAFT"}, 1),
    "draft-local": (True, "fake-app", {**ENTRY, "guardrailVersion": "DRAFT"}, 1),
    "zero": (False, "fake-app", {**ENTRY, "guardrailVersion": "0"}, 1),
    "zero-local": (True, "fake-app", {**ENTRY, "guardrailVersion": "0"}, 1),
    "reread": (False, "fake-app", ENTRY, 0),
    "concurrent": (False, "fake-app", ENTRY, 0),
    "blocked-session": (False, "fake-app", ENTRY, 0),
    "blocked-session-stream": (False, "fake-app", ENTRY, 0),
}


def write_config(path: str, entry: dict[str, str] | None, class_name: str) -> None:
    data: dict[str, Any] = {"agentRuntimes": {}}
    if entry is not None:
        data["guardrails"] = {class_name: entry}
    with open(path, "w") as f:
        json.dump(data, f)


def read_log(path: str) -> list[dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


class WarningRecorder(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        if record.name.endswith(".guardrail"):
            self.messages.append(record.getMessage())


def run_scenario(name: str) -> dict[str, Any]:
    local_dev, app_id, entry, calls = SCENARIOS[name]
    work = tempfile.mkdtemp(prefix=f"{name}-")
    config_file, log_file = os.path.join(work, "config.json"), os.path.join(work, "requests.log")
    # The vended local session storage is relative to the project root, two levels down.
    cwd = os.path.join(work, "packages", "project")
    os.makedirs(cwd)
    os.chdir(cwd)

    spec = importlib.util.spec_from_file_location("fake_aws", FAKE_AWS)
    assert spec and spec.loader
    fake_aws = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fake_aws)
    _server, port = fake_aws.start_server(config_file, log_file)
    os.environ["AWS_ENDPOINT_URL_APPCONFIGDATA"] = f"http://127.0.0.1:{port}"
    os.environ["AWS_ENDPOINT_URL_BEDROCK_RUNTIME"] = f"http://127.0.0.1:{port}"
    os.environ.pop("LOCAL_DEV", None)
    os.environ.pop("RUNTIME_CONFIG_APP_ID", None)
    if local_dev:
        os.environ["LOCAL_DEV"] = "true"
    if app_id:
        os.environ["RUNTIME_CONFIG_APP_ID"] = app_id

    recorder = WarningRecorder()
    logging.getLogger().addHandler(recorder)

    sys.path[:0] = [ROOT, CONNECTION_ROOT]
    agent_module = importlib.import_module(f"{AGENT_PACKAGE}.agent")
    guardrail_module = importlib.import_module(f"{AGENT_PACKAGE}.guardrail")
    class_name = guardrail_module.RUNTIME_CONFIG_KEY.split(".")[-1]
    write_config(config_file, entry, class_name)

    result: dict[str, Any] = {"calls": []}

    def snapshot() -> dict[str, Any]:
        log = read_log(log_file)
        return {
            "models": [r for r in log if "modelId" in r],
            "appConfigCalls": len([r for r in log if "modelId" not in r]),
        }

    async def scenario() -> None:
        if FRAMEWORK == "strands":
            connection = importlib.import_module(CONNECTION_MODULE)

            @contextmanager
            def agent_scope():
                with connection.session_id_context("s1"), agent_module.get_agent() as agent:
                    yield agent

            async def call(agent: Any, prompt: str = "2+2?") -> None:
                await agent.invoke_async(prompt)

            if name == "concurrent":
                from strands import Agent

                shared = guardrail_module.get_guardrailed_model()
                agents = [Agent(model=shared, callback_handler=None) for _ in range(10)]
                await asyncio.gather(*[a.invoke_async("2+2?") for a in agents])
                return
            with agent_scope() as agent:
                await run_calls(agent, call)
        else:
            graph = agent_module.get_agent()
            counter = iter(range(1000))

            async def call(agent: Any, prompt: str | None = None) -> None:
                # A call with a prompt continues one session; without, each call is a new session.
                if name == "blocked-session-stream":
                    await stream(agent, prompt)
                    return
                thread = {"configurable": {"thread_id": "session" if prompt else f"t{next(counter)}"}}
                await agent.ainvoke({"messages": [{"role": "user", "content": prompt or "2+2?"}]}, thread)

            async def stream(agent: Any, prompt: str | None = None) -> None:
                thread = {"configurable": {"thread_id": "session" if prompt else f"t{next(counter)}"}}
                async for _ in agent.astream(
                    {"messages": [{"role": "user", "content": prompt or "2+2?"}]}, thread, stream_mode="messages"
                ):
                    pass

            if name == "concurrent":
                await asyncio.gather(*[call(graph) for _ in range(10)])
                return
            await run_calls(graph, call)
            if name == "guarded":
                await stream(graph)
                result["streamed"] = snapshot()["models"][-1:]

    async def run_calls(agent: Any, call: Any) -> None:
        if name.startswith("blocked-session"):
            # A blocked message, then a normal one, in the same session.
            for prompt in (BLOCKED_PROMPT, "2+2?"):
                await call(agent, prompt)
                result["calls"].append(snapshot())
            return
        if name == "reread":
            await call(agent)
            result["calls"].append(snapshot())
            write_config(config_file, {**ENTRY, "guardrailVersion": "2"}, class_name)
            await call(agent)
            result["calls"].append(snapshot())
            time.sleep(5.5)
            await call(agent)
            result["calls"].append(snapshot())
            return
        for _ in range(calls):
            await call(agent)
            result["calls"].append(snapshot())

    try:
        asyncio.run(scenario())
    except Exception as e:  # noqa: BLE001 - reported to the spec
        result["error"] = {"type": type(e).__name__, "message": str(e)}
    result.update(snapshot())
    result["warnings"] = recorder.messages
    shutil.rmtree(work, ignore_errors=True)
    return result


def run_static() -> dict[str, Any]:
    package_dir = os.path.join(ROOT, *AGENT_PACKAGE.split("."))
    files = [os.path.join(package_dir, f) for f in ("guardrail.py", "agent.py")]
    # uv's --with environment layers several site-packages directories, which
    # ty does not discover from the interpreter alone.
    search_paths = [CONNECTION_ROOT, *(p for p in sys.path if p.endswith("site-packages"))]
    commands = {
        "ty": [
            "ty",
            "check",
            "--python",
            sys.executable,
            *(arg for path in search_paths for arg in ("--extra-search-path", path)),
            "--no-progress",
            *files,
        ],
        "ruffFormat": ["ruff", "format", "--check", *files],
        "ruffCheck": ["ruff", "check", "--select", "E,F,UP,B,SIM,I", *files],
    }
    results = {}
    for key, command in commands.items():
        done = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        results[key] = {"code": done.returncode, "output": done.stdout + done.stderr}
    return results


if __name__ == "__main__":
    if len(sys.argv) > 7:
        print("\nRESULT " + json.dumps(run_scenario(sys.argv[7])), flush=True)
        # A failed LangChain call in local dev leaves the SQLite checkpointer's
        # non-daemon thread running, which would keep the interpreter alive.
        os._exit(0)
    else:
        results: dict[str, Any] = {}
        for scenario_name in SCENARIOS:
            done = subprocess.run(
                [sys.executable, __file__, *sys.argv[1:7], scenario_name],
                capture_output=True,
                text=True,
                timeout=180,
            )
            lines = [line for line in done.stdout.splitlines() if line.startswith("RESULT ")]
            results[scenario_name] = (
                json.loads(lines[-1][len("RESULT ") :])
                if lines
                else {"crashed": done.returncode, "stdout": done.stdout[-4000:], "stderr": done.stderr[-4000:]}
            )
        results["static"] = run_static()
        print("RESULTS " + json.dumps(results), flush=True)
