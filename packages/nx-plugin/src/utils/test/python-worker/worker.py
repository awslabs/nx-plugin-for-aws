# 
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
# 

from __future__ import annotations

import asyncio
import atexit
import glob
import importlib
import io
import itertools
import json
import os
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
import types
import warnings
from typing import Any, Callable

import httpx
import pydantic


# ─── Mock httpx transport ────────────────────────────────────────────────
class NoMockMatched(Exception):
    """Raised when a request matches no mock entry, so the test fails loudly."""


class OffSpecRequest(Exception):
    """Raised when a request targets no route the OpenAPI spec declares.

    A mock that matched any request would let a client send the wrong method or
    URL and still satisfy every assertion about what came back, so the routes
    the spec declares are checked independently of mock matching.
    """


def _wire_path(request: httpx.Request) -> str:
    """The request path as sent, keeping percent-encoding intact.

    `request.url.path` decodes, which would turn an encoded `%2F` inside a path
    parameter back into a separator and split one segment into two.
    """
    return request.url.raw_path.decode("ascii").split("?", 1)[0]


class _RouteSpec:
    """One `method` + path template the spec declares, as a regex."""

    def __init__(self, method: str, path_template: str) -> None:
        self.method = method.upper()
        self.path_template = path_template
        # A path parameter matches any single segment, whatever style it uses:
        # `simple` renders a bare value, `matrix` a `;name=` prefix and `label` a
        # `.` prefix, all within the one segment the template declares.
        pattern = "".join(
            "[^/]*" if part.startswith("{") and part.endswith("}") else re.escape(part)
            for part in re.split(r"(\{[^}]*\})", path_template)
        )
        self.pattern = re.compile(f"^{pattern}$")

    def matches(self, request: httpx.Request) -> bool:
        return request.method.upper() == self.method and bool(
            self.pattern.match(_wire_path(request))
        )

    def __str__(self) -> str:
        return f"{self.method} {self.path_template}"


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


class _ChunkedStream(httpx.SyncByteStream, httpx.AsyncByteStream):
    """Serves a body as a fixed list of chunks, sync or async."""

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


class _MockTransport(httpx.BaseTransport, httpx.AsyncBaseTransport):
    """Deterministic transport for both sync and async httpx clients."""

    def __init__(self, entries: list[dict], routes: list[dict] | None = None) -> None:
        self.entries = [_MockMatch(e) for e in entries]
        self.routes = [_RouteSpec(r["method"], r["path"]) for r in routes or []]
        self.calls: list[dict] = []
        # Streamed responses handed out, and the ones whose body was released.
        # A test asks whether closing a stream reached the response.
        self.responses: list[httpx.Response] = []
        self.released: list[httpx.Response] = []

    def _record(self, request: httpx.Request) -> None:
        try:
            # Multipart bodies are streamed; read() materialises request.content.
            request.read()
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
        # A transport-level failure a real network produces, so a test can check
        # it reaches the caller rather than being turned into an API error.
        if spec.get("raise_timeout"):
            raise httpx.TimeoutException("mock timeout")
        if spec.get("raise_connect_error"):
            raise httpx.ConnectError("mock connect error")
        status = spec.get("status", 200)
        # Copied because the defaults applied below would otherwise persist onto
        # the caller's spec and leak into a later replay of the same entry.
        headers = dict(spec.get("headers", {}))
        if "jsonl_lines" in spec:
            newline = spec.get("newline", "\n")
            body = (newline.join(spec["jsonl_lines"]) + newline).encode("utf-8")
            headers.setdefault("content-type", "application/jsonl")
            if "chunk_size" in spec:
                # Served in fixed-size pieces so a line spanning two chunks
                # exercises the client's buffering. A single chunk would let a
                # client that discards the buffer between reads still pass.
                size = spec["chunk_size"]
                chunks = [body[i : i + size] for i in range(0, len(body), size)]
                return httpx.Response(
                    status_code=status,
                    headers=headers,
                    stream=_ChunkedStream(chunks),
                )
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

    def _track_release(self, response: httpx.Response) -> None:
        """Record the response once it is closed.

        A streamed response is closed by the `with client.stream(...)` block
        inside the generated method exiting, so this reports whether a caller's
        `close()`/`aclose()` on the stream reached that far.
        """
        original_close = response.close
        original_aclose = response.aclose
        released = self.released

        def close() -> None:
            released.append(response)
            original_close()

        async def aclose() -> None:
            released.append(response)
            await original_aclose()

        response.close = close  # type: ignore[method-assign]
        response.aclose = aclose  # type: ignore[method-assign]

    def _match(self, request: httpx.Request) -> httpx.Response:
        self._record(request)
        # Checked before the mocks: a client requesting a route the spec never
        # declared is wrong regardless of which mock would have answered it.
        if self.routes and not any(route.matches(request) for route in self.routes):
            raise OffSpecRequest(
                f"{request.method} {_wire_path(request)} matches no route the spec "
                f"declares: {', '.join(str(r) for r in self.routes)}"
            )
        for entry in self.entries:
            if entry.matches(request):
                entry.used = True
                response = self._build_response(entry.response)
                self.responses.append(response)
                self._track_release(response)
                return response
        # A request no mock describes is a mistake in the test, not a response
        # the client should interpret: raise so it can't be mistaken for one.
        raise NoMockMatched(f"No mock matched {request.method} {request.url}")

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        return self._match(request)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        try:
            # Async multipart bodies stream; aread() materialises request.content.
            await request.aread()
        except Exception:
            pass
        return self._match(request)


# ─── Module loading ──────────────────────────────────────────────────────
_PACKAGE_DIR: str | None = None


def _cleanup_package_dir() -> None:
    """Remove this worker's package directory on exit.

    Each compile replaces the previous directory, but the final one would
    otherwise outlive the worker.
    """
    if _PACKAGE_DIR and os.path.isdir(_PACKAGE_DIR):
        shutil.rmtree(_PACKAGE_DIR, ignore_errors=True)


atexit.register(_cleanup_package_dir)


def _reap_orphaned_dirs() -> None:
    """Delete package directories left by workers that are no longer running.

    `atexit` doesn't run when a worker is killed rather than asked to stop, so a
    crashed run leaves its directories behind. Each is named after the process
    that owns it, which lets a later worker tell an orphan from a live one.
    """
    for entry in glob.glob(os.path.join(tempfile.gettempdir(), "pyclient-*")):
        # `pyclient-<pid>-<random>`; anything else predates this naming.
        parts = os.path.basename(entry).split("-")
        if len(parts) < 3 or not parts[1].isdigit():
            continue
        pid_part = parts[1]
        if int(pid_part) == os.getpid():
            continue
        try:
            os.kill(int(pid_part), 0)
        except ProcessLookupError:
            shutil.rmtree(entry, ignore_errors=True)
        except OSError:
            # Owned by another user, or otherwise not ours to remove.
            continue


_reap_orphaned_dirs()


def _write_files(files: dict[str, str], pkg_name: str = "generated") -> str:
    """Lay files out as `<tmpdir>/<pkg_name>/...` so the parent dir is on
    sys.path and the package imports as `pkg_name`."""
    global _PACKAGE_DIR
    if _PACKAGE_DIR and os.path.isdir(_PACKAGE_DIR):
        shutil.rmtree(_PACKAGE_DIR)
    # Named after this process, so a later worker can reap it if we are killed.
    _PACKAGE_DIR = tempfile.mkdtemp(prefix=f"pyclient-{os.getpid()}-")
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


def _site_packages_paths() -> list[str]:
    """The directories holding this worker's third-party packages.

    `uv run --with` layers packages in from its cache rather than installing
    them under `sys.prefix`, so the directories are derived from the imported
    modules themselves — that way `ty` resolves the same versions the code
    under test runs against.
    """
    paths: list[str] = []
    for module in (httpx, pydantic):
        directory = os.path.dirname(os.path.dirname(module.__file__ or ""))
        if directory and directory not in paths:
            paths.append(directory)
    return paths


def _type_check(root: str, pkg_name: str) -> list[str]:
    """Type check the package with `ty`, returning one message per diagnostic.

    `ty` is the checker the plugin's Python projects run, so a generated client
    is held to what a consumer's own `typecheck` target would report.
    """
    ty = shutil.which("ty")
    if not ty:
        return ["ty is not available on PATH"]
    search_paths: list[str] = []
    for directory in _site_packages_paths():
        search_paths += ["--extra-search-path", directory]
    result = subprocess.run(  # noqa: S603
        [
            ty,
            "check",
            "--python",
            sys.prefix,
            *search_paths,
            "--output-format",
            "concise",
            pkg_name,
        ],
        capture_output=True,
        text=True,
        cwd=root,
    )
    if result.returncode == 0:
        return []
    output = (result.stdout + result.stderr).strip().splitlines()
    return [
        line for line in output if ": error[" in line or ": warning[" in line
    ] or output


# ─── Command handlers ────────────────────────────────────────────────────
# The files and package name last type checked. A suite that regenerates the
# same client for each of its tests would otherwise re-run `ty` over identical
# input every time, which is the bulk of its cost.
_last_type_checked: tuple[str, str] | None = None


def handle_compile(req: dict) -> dict:
    pkg_name = req.get("package", "generated")
    files = req["files"]
    root = _write_files(files, pkg_name)
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
    if req.get("type_check"):
        global _last_type_checked
        fingerprint = (pkg_name, json.dumps(files, sort_keys=True))
        if fingerprint != _last_type_checked:
            diagnostics = _type_check(root, pkg_name)
            if diagnostics:
                return {
                    "ok": False,
                    "error": "type_check_failed",
                    "details": diagnostics,
                }
            _last_type_checked = fingerprint
    return {"ok": True, "value": None}


def handle_type_check_usage(req: dict) -> dict:
    """Type check a caller-supplied module against the compiled package.

    Returns the diagnostics rather than failing, so a test can assert that
    intentionally-wrong usage is rejected as well as that valid usage is not.
    """
    if not _PACKAGE_DIR:
        raise RuntimeError("no files loaded — compile first")
    pkg_name = req.get("package", "generated")
    usage_path = os.path.join(_PACKAGE_DIR, pkg_name, "_usage_probe.py")
    with open(usage_path, "w", encoding="utf-8") as f:
        f.write(req["usage"])
    try:
        return {"ok": True, "diagnostics": _type_check(_PACKAGE_DIR, pkg_name)}
    finally:
        os.remove(usage_path)


def _resolve_invoke(module_kind: str, mod: types.ModuleType) -> tuple[Any, str]:
    """Locate the generated client class and its Config inside the package.

    Selection is by defining module rather than by name, so a spec whose title
    starts with "Async" still resolves to the right client.
    """
    is_async = module_kind == "async"
    wanted_module = "async_client" if is_async else "client"
    for name in getattr(mod, "__all__", []) or dir(mod):
        if not isinstance(name, str):
            continue
        obj = getattr(mod, name, None)
        if not isinstance(obj, type) or name.endswith("Config"):
            continue
        defining_module = getattr(obj, "__module__", "")
        if not defining_module.endswith(wanted_module):
            continue
        # `client` also ends `async_client`, so the sync client is the
        # one whose module isn't the async module.
        if not is_async and defining_module.endswith("async_client"):
            continue
        return obj, name
    raise RuntimeError(
        f"Could not locate {'async ' if is_async else ''}client class in {mod.__name__}"
    )


class _BodyDigestAuth(httpx.Auth):
    """Signs each request with a digest of its body.

    Standing in for a real signer (SigV4, say): a generated client that bypassed
    the auth flow, or that sent a body other than the one asserted on, could not
    produce the expected header.
    """

    requires_request_body = True

    def auth_flow(self, request: httpx.Request):
        request.headers["x-body-digest"] = (
            request.content.decode("utf-8") if request.content else ""
        )
        yield request


def _build_mock_client(
    kind: str,
    entries: list[dict],
    client_kwargs: dict | None = None,
    auth: str | None = None,
    event_hook_header: str | None = None,
    routes: list[dict] | None = None,
) -> tuple[Any, _MockTransport]:
    transport = _MockTransport(entries, routes)
    kwargs: dict[str, Any] = {
        "transport": transport,
        "base_url": "http://mock",
        **(client_kwargs or {}),
    }
    if auth == "body-digest":
        kwargs["auth"] = _BodyDigestAuth()
    if event_hook_header:
        # An AsyncClient only awaits its hooks, so each flavour needs its own.
        def _hook(request: httpx.Request) -> None:
            request.headers[event_hook_header] = "yes"

        async def _async_hook(request: httpx.Request) -> None:
            request.headers[event_hook_header] = "yes"

        kwargs["event_hooks"] = {
            "request": [_hook if kind == "sync" else _async_hook]
        }
    if kind == "sync":
        return httpx.Client(**kwargs), transport
    return httpx.AsyncClient(**kwargs), transport


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
    # When set, the stream is abandoned after this many items and then closed.
    stream_take = req.get("stream_take")

    client_cls, cls_name = _resolve_invoke(module_kind, pkg)
    config_cls = getattr(pkg, f"{cls_name}Config")

    httpx_client, transport = _build_mock_client(
        module_kind,
        req.get("mock", []),
        req.get("httpx_client_kwargs") or {},
        req.get("auth"),
        req.get("event_hook_header"),
        req.get("routes") or [],
    )
    client = client_cls(
        config_cls(
            url=req.get("base_url", "http://mock"),
            httpx_client=httpx_client,
            **req.get("client_kwargs", {}),
        )
    )

    args = req.get("args", [])
    kwargs = req.get("kwargs", {})
    # The client doesn't own the httpx client here, so closing it must leave the
    # caller's client usable for the call that follows.
    if req.get("close_then_reuse"):
        closer = getattr(client, "close", None)
        if callable(closer):
            closer()

    def _stream_released() -> bool:
        # Whether closing the stream reached the response body. The release runs
        # when the `with client.stream(...)` block inside the generated method
        # exits, so a delegate that re-yields rather than forwarding close()
        # never gets there and holds the connection until GC.
        return len(transport.released) == len(transport.responses) > 0

    def _resolve_method(obj: Any, dotted: str) -> Callable[..., Any]:
        for part in dotted.split("."):
            obj = getattr(obj, part)
        return obj

    def _invoke_sync() -> Any:
        fn = _resolve_method(client, method_name)
        try:
            if is_stream:
                if stream_take is not None:
                    # Stop early and close, so a delegate that doesn't forward
                    # close() to the generator actually producing the items
                    # leaves the response open and is caught below.
                    stream = fn(*args, **kwargs)
                    taken = list(itertools.islice(stream, stream_take))
                    stream.close()
                    return {"items": taken, "closed": _stream_released()}
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
                if stream_take is not None:
                    stream = fn(*args, **kwargs)
                    taken: list[Any] = []
                    async for item in stream:
                        taken.append(item)
                        if len(taken) >= stream_take:
                            break
                    await stream.aclose()
                    return {"items": taken, "closed": _stream_released()}
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
        with warnings.catch_warnings():
            # A deprecation the generated code triggers is a defect callers would
            # see, so a test can ask for it to fail the call.
            if req.get("error_on_warning"):
                warnings.simplefilter("error")
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
        catch_as = req.get("catch_as")
        if catch_as:
            expected = getattr(pkg, catch_as, None)
            exc_info["caught_as"] = isinstance(expected, type) and isinstance(
                exc, expected
            )
        return {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "exception": exc_info,
            "traceback": traceback.format_exc(),
            "calls": transport.calls,
        }

    response = {
        "ok": True,
        "value": _to_jsonable(result),
        "py_type": type(result).__name__,
        "calls": transport.calls,
    }
    # The Python type of each element, so a list parsed as a single scalar (or
    # with the wrong element type) is distinguishable from a correct one.
    if isinstance(result, (list, tuple)):
        response["py_element_types"] = [type(item).__name__ for item in result]
    return response


# ─── Dispatch loop ───────────────────────────────────────────────────────
HANDLERS: dict[str, Callable[[dict], dict]] = {
    "compile": handle_compile,
    "invoke": handle_invoke,
    "type_check_usage": handle_type_check_usage,
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
