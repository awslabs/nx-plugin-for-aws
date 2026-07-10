# 
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
# 

from __future__ import annotations

import asyncio
import importlib
import io
import json
import os
import py_compile
import shutil
import sys
import tempfile
import traceback
import types
from typing import Any, Callable

import httpx


# ─── Mock httpx transport ────────────────────────────────────────────────
class _MockMatch:
    """Matches a mock entry against a live httpx.Request."""

    def __init__(self, entry: dict) -> None:
        self.method = entry.get("method", "").upper() if entry.get("method") else None
        self.url_contains = entry.get("url_contains")
        self.url_equals = entry.get("url_equals")
        self.path = entry.get("path")
        self.response = entry["response"]
        self.used = False

    def matches(self, request: httpx.Request) -> bool:
        if self.method and request.method.upper() != self.method:
            return False
        url = str(request.url)
        if self.url_contains and self.url_contains not in url:
            return False
        if self.url_equals and url != self.url_equals:
            return False
        if self.path and request.url.path != self.path:
            return False
        return True


class _MockTransport(httpx.BaseTransport, httpx.AsyncBaseTransport):
    """Deterministic transport for both sync and async httpx clients."""

    def __init__(self, entries: list[dict]) -> None:
        self.entries = [_MockMatch(e) for e in entries]
        self.calls: list[dict] = []

    def _record(self, request: httpx.Request) -> None:
        try:
            body = request.content.decode("utf-8") if request.content else None
        except Exception:
            body = None
        self.calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
                "body": body,
            }
        )

    def _build_response(self, spec: dict) -> httpx.Response:
        status = spec.get("status", 200)
        headers = spec.get("headers", {})
        if "jsonl_lines" in spec:
            body = ("\n".join(spec["jsonl_lines"]) + "\n").encode("utf-8")
            headers.setdefault("content-type", "application/jsonl")
        elif "json" in spec:
            body = json.dumps(spec["json"]).encode("utf-8")
            headers.setdefault("content-type", "application/json")
        elif "text" in spec:
            body = spec["text"].encode("utf-8")
        elif "bytes_b64" in spec:
            import base64

            body = base64.b64decode(spec["bytes_b64"])
        else:
            body = b""
        return httpx.Response(status_code=status, headers=headers, content=body)

    def _match(self, request: httpx.Request) -> httpx.Response:
        self._record(request)
        for entry in self.entries:
            if entry.matches(request):
                return self._build_response(entry.response)
        # Default 404 when nothing matches — makes tests fail loudly.
        return httpx.Response(
            status_code=599,
            content=f"No mock matched {request.method} {request.url}".encode("utf-8"),
        )

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        return self._match(request)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return self._match(request)


# ─── Module loading ──────────────────────────────────────────────────────
_PACKAGE_DIR: str | None = None


def _write_files(files: dict[str, str], pkg_name: str = "generated") -> str:
    """Lay files out as `<tmpdir>/<pkg_name>/...` so the parent dir is on
    sys.path and the package imports as `pkg_name`."""
    global _PACKAGE_DIR
    if _PACKAGE_DIR and os.path.isdir(_PACKAGE_DIR):
        shutil.rmtree(_PACKAGE_DIR)
    _PACKAGE_DIR = tempfile.mkdtemp(prefix="pyclient-")
    pkg_dir = os.path.join(_PACKAGE_DIR, pkg_name)
    os.makedirs(pkg_dir, exist_ok=True)
    for rel, content in files.items():
        abs_path = os.path.join(pkg_dir, rel)
        parent = os.path.dirname(abs_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(content)
    return _PACKAGE_DIR


def _compile_all(root: str) -> list[str]:
    """Return a list of error messages for any .py file that fails to parse."""
    errors: list[str] = []
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if name.endswith(".py"):
                path = os.path.join(dirpath, name)
                try:
                    py_compile.compile(path, doraise=True)
                except py_compile.PyCompileError as exc:
                    errors.append(f"{path}: {exc.msg or exc}")
    return errors


_previous_roots: list[str] = []


def _load_generated(root: str, pkg_name: str = "generated") -> types.ModuleType:
    """Import `<root>/<pkg_name>` as a fresh module."""
    for key in list(sys.modules):
        if key == pkg_name or key.startswith(pkg_name + "."):
            del sys.modules[key]
    # Drop previously-inserted roots so Python can't resolve the package
    # against a stale (possibly deleted) directory.
    for stale in _previous_roots:
        while stale in sys.path:
            sys.path.remove(stale)
    _previous_roots.clear()
    sys.path.insert(0, root)
    _previous_roots.append(root)
    # Drop bytecode cache for a clean reimport.
    importlib.invalidate_caches()
    return importlib.import_module(pkg_name)


# ─── Command handlers ────────────────────────────────────────────────────
def handle_compile(req: dict) -> dict:
    pkg_name = req.get("package", "generated")
    root = _write_files(req["files"], pkg_name)
    errors = _compile_all(root)
    if errors:
        return {"ok": False, "error": "compile_failed", "details": errors}
    try:
        _load_generated(root, pkg_name)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(),
        }
    return {"ok": True, "value": None}


def _resolve_invoke(module_kind: str, mod: types.ModuleType) -> tuple[Any, str]:
    """Locate the generated client class and its Config inside the package."""
    is_async = module_kind == "async"
    for name in getattr(mod, "__all__", []) or dir(mod):
        if not isinstance(name, str):
            continue
        obj = getattr(mod, name, None)
        if not isinstance(obj, type):
            continue
        if name.endswith("Config"):
            continue
        if is_async and name.startswith("Async"):
            return obj, name
        if not is_async and not name.startswith("Async"):
            # Filter to classes defined inside this package (not imported types).
            if getattr(obj, "__module__", "").endswith("client_gen"):
                return obj, name
    raise RuntimeError(
        f"Could not locate {'async ' if is_async else ''}client class in {mod.__name__}"
    )


def _build_mock_client(kind: str, entries: list[dict]) -> tuple[Any, _MockTransport]:
    transport = _MockTransport(entries)
    if kind == "sync":
        return httpx.Client(transport=transport, base_url="http://mock"), transport
    return httpx.AsyncClient(transport=transport, base_url="http://mock"), transport


def _to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True, exclude_unset=False)
    return repr(value)


def handle_invoke(req: dict) -> dict:
    if not _PACKAGE_DIR:
        raise RuntimeError("no files loaded — compile first")
    pkg = _load_generated(_PACKAGE_DIR, req.get("package", "generated"))
    method_name = req["method"]
    module_kind = req["module"]  # "sync" | "async"
    is_stream = bool(req.get("stream"))

    client_cls, cls_name = _resolve_invoke(module_kind, pkg)
    config_cls = getattr(pkg, f"{cls_name}Config")

    httpx_client, transport = _build_mock_client(module_kind, req.get("mock", []))
    client = client_cls(
        config_cls(
            url=req.get("base_url", "http://mock"),
            httpx_client=httpx_client,
            **req.get("client_kwargs", {}),
        )
    )

    args = req.get("args", [])
    kwargs = req.get("kwargs", {})

    def _resolve_method(obj: Any, dotted: str) -> Callable[..., Any]:
        for part in dotted.split("."):
            obj = getattr(obj, part)
        return obj

    def _invoke_sync() -> Any:
        fn = _resolve_method(client, method_name)
        try:
            if is_stream:
                return list(fn(*args, **kwargs))
            return fn(*args, **kwargs)
        finally:
            try:
                httpx_client.close()
            except Exception:
                pass

    async def _invoke_async() -> Any:
        fn = _resolve_method(client, method_name)
        try:
            if is_stream:
                collected: list[Any] = []
                async for item in fn(*args, **kwargs):
                    collected.append(item)
                return collected
            return await fn(*args, **kwargs)
        finally:
            try:
                await httpx_client.aclose()
            except Exception:
                pass

    try:
        if module_kind == "sync":
            result = _invoke_sync()
        else:
            result = asyncio.run(_invoke_async())
    except Exception as exc:  # noqa: BLE001
        exc_info: dict[str, Any] = {
            "type": type(exc).__name__,
        }
        error_payload = getattr(exc, "error", None)
        if error_payload is not None:
            exc_info["error_type"] = type(error_payload).__name__
            exc_info["error"] = _to_jsonable(error_payload)
        if hasattr(exc, "status"):
            exc_info["status"] = getattr(exc, "status")
        return {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "exception": exc_info,
            "traceback": traceback.format_exc(),
            "calls": transport.calls,
        }

    return {
        "ok": True,
        "value": _to_jsonable(result),
        "calls": transport.calls,
    }


# ─── Dispatch loop ───────────────────────────────────────────────────────
HANDLERS: dict[str, Callable[[dict], dict]] = {
    "compile": handle_compile,
    "invoke": handle_invoke,
}


def _main() -> None:
    # Line-buffered stdout so parent sees responses immediately.
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            handler = HANDLERS.get(req.get("cmd"))
            if not handler:
                resp = {"ok": False, "error": f"unknown command: {req.get('cmd')}"}
            else:
                resp = handler(req)
        except Exception as exc:  # noqa: BLE001
            resp = {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
            }
        sys.stdout.write(json.dumps(resp) + "\n")


if __name__ == "__main__":
    _main()
