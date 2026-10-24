# 
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
# 
"""Local stand-in for AppConfigData and Bedrock Runtime, so tests of generated
agent code send real SDK requests without AWS. Standard library only.

Usage: python fake_aws.py <config.json> <port> <requests.log>
or, in-process: start_server(config_file, log_file) returns (server, port).

- AppConfigData: POST /configurationsessions and GET /configuration serve the
  JSON in <config.json>, re-read on every request, so editing the file changes
  the value. A session whose ApplicationIdentifier is "broken" answers HTTP 400
  BadRequestException, to simulate a read failure.
- Bedrock Runtime: POST /model/<id>/converse-stream (event stream) and
  /model/<id>/converse (JSON) answer "4".

Every request appends one JSON line to <requests.log>: AppConfigData requests
as {"path": "StartConfigurationSession" | "GetLatestConfiguration"}, model
requests as {"path", "modelId", "guardrailConfig"}.
"""

import binascii
import json
import struct
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _header(name: str, value: str) -> bytes:
    n, v = name.encode(), value.encode()
    return struct.pack("B", len(n)) + n + b"\x07" + struct.pack(">H", len(v)) + v


def _event(event_type: str, payload: dict) -> bytes:
    headers = (
        _header(":event-type", event_type)
        + _header(":content-type", "application/json")
        + _header(":message-type", "event")
    )
    body = json.dumps(payload).encode()
    total = 12 + len(headers) + len(body) + 4
    prelude = struct.pack(">II", total, len(headers))
    prelude += struct.pack(">I", binascii.crc32(prelude) & 0xFFFFFFFF)
    message = prelude + headers + body
    return message + struct.pack(">I", binascii.crc32(message) & 0xFFFFFFFF)


def _handler(config_file: str, log_file: str) -> type[BaseHTTPRequestHandler]:
    lock = threading.Lock()

    def log(entry: dict) -> None:
        with lock, open(log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args) -> None:
            pass

        def _send(self, status: int, body: bytes, content_type: str, extra=None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path.startswith("/configuration"):
                log({"path": "GetLatestConfiguration"})
                with open(config_file, "rb") as f:
                    body = f.read()
                self._send(
                    200,
                    body,
                    "application/json",
                    {"Next-Poll-Configuration-Token": "token", "Next-Poll-Interval-In-Seconds": "60"},
                )
                return
            self._send(404, b"{}", "application/json")

        def do_POST(self) -> None:
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            if self.path.startswith("/configurationsessions"):
                log({"path": "StartConfigurationSession"})
                if json.loads(raw or b"{}").get("ApplicationIdentifier") == "broken":
                    self._send(
                        400,
                        json.dumps({"Message": "Application broken does not exist."}).encode(),
                        "application/json",
                        {"x-amzn-ErrorType": "BadRequestException"},
                    )
                    return
                self._send(201, json.dumps({"InitialConfigurationToken": "token"}).encode(), "application/json")
                return
            if self.path.startswith("/model/"):
                request = json.loads(raw or b"{}")
                model_id = urllib.parse.unquote(self.path.split("/")[2])
                log(
                    {
                        "path": self.path.split("/")[-1],
                        "modelId": model_id,
                        "guardrailConfig": request.get("guardrailConfig"),
                    }
                )
                if self.path.endswith("/converse-stream"):
                    body = b"".join(
                        [
                            _event("messageStart", {"role": "assistant"}),
                            _event("contentBlockDelta", {"contentBlockIndex": 0, "delta": {"text": "4"}}),
                            _event("contentBlockStop", {"contentBlockIndex": 0}),
                            _event("messageStop", {"stopReason": "end_turn"}),
                            _event(
                                "metadata",
                                {
                                    "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
                                    "metrics": {"latencyMs": 1},
                                },
                            ),
                        ]
                    )
                    self._send(200, body, "application/vnd.amazon.eventstream")
                    return
                answer = {
                    "output": {"message": {"role": "assistant", "content": [{"text": "4"}]}},
                    "stopReason": "end_turn",
                    "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
                    "metrics": {"latencyMs": 1},
                }
                self._send(200, json.dumps(answer).encode(), "application/json")
                return
            self._send(404, b"{}", "application/json")

    return Handler


def start_server(config_file: str, log_file: str, port: int = 0) -> tuple[ThreadingHTTPServer, int]:
    """Serve on 127.0.0.1 in a daemon thread; port 0 picks a free port."""
    server = ThreadingHTTPServer(("127.0.0.1", port), _handler(config_file, log_file))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), _handler(sys.argv[1], sys.argv[3])).serve_forever()
