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
  /model/<id>/converse (JSON) answer "4". A request with a guardrailConfig gets
  BLOCKED_ANSWER with stop reason guardrail_intervened and a BLOCKED trace when
  the text the guardrail checks contains DENIED_TERM. As in Bedrock, the
  guardrail checks only the guardContent blocks if the messages hold any, and
  every message otherwise.

Every request appends one JSON line to <requests.log>: AppConfigData requests
as {"path": "StartConfigurationSession" | "GetLatestConfiguration"}, model
requests as {"path", "modelId", "guardrailConfig", "userTexts", "intervened"}.
"""

import binascii
import json
import struct
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DENIED_TERM = "stocks"
BLOCKED_ANSWER = "Sorry, I can't help with that request."


class FakeAwsServer(ThreadingHTTPServer):
    """Queue concurrent SDK connection bursts while requests are accepted."""

    request_queue_size = 128


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


def _texts(blocks: list) -> list[str]:
    texts = []
    for block in blocks:
        if "text" in block:
            texts.append(block["text"])
        elif "guardContent" in block:
            texts.append(block["guardContent"].get("text", {}).get("text", ""))
        elif "toolResult" in block:
            texts.extend(_texts(block["toolResult"].get("content", [])))
    return texts


def _intervenes(request: dict) -> bool:
    """Whether the guardrail blocks the request's input, by Bedrock's rule for guardContent."""
    if not request.get("guardrailConfig"):
        return False
    messages = request.get("messages", [])
    guarded = [
        block["guardContent"].get("text", {}).get("text", "")
        for message in messages
        for block in message.get("content", [])
        if "guardContent" in block
    ]
    checked = guarded or [text for message in messages for text in _texts(message.get("content", []))]
    return any(DENIED_TERM in text.lower() for text in checked)


_BLOCKED_TRACE = {
    "guardrail": {
        "inputAssessment": {
            "grtest": {
                "topicPolicy": {
                    "topics": [{"name": "Investment advice", "type": "DENY", "action": "BLOCKED", "detected": True}]
                }
            }
        }
    }
}


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
                intervened = _intervenes(request)
                log(
                    {
                        "path": self.path.split("/")[-1],
                        "modelId": model_id,
                        "guardrailConfig": request.get("guardrailConfig"),
                        "userTexts": [
                            text
                            for message in request.get("messages", [])
                            if message.get("role") == "user"
                            for text in _texts(message.get("content", []))
                        ],
                        "intervened": intervened,
                    }
                )
                text = BLOCKED_ANSWER if intervened else "4"
                stop_reason = "guardrail_intervened" if intervened else "end_turn"
                metadata = {
                    "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
                    "metrics": {"latencyMs": 1},
                    **({"trace": _BLOCKED_TRACE} if intervened else {}),
                }
                if self.path.endswith("/converse-stream"):
                    body = b"".join(
                        [
                            _event("messageStart", {"role": "assistant"}),
                            _event("contentBlockDelta", {"contentBlockIndex": 0, "delta": {"text": text}}),
                            _event("contentBlockStop", {"contentBlockIndex": 0}),
                            _event("messageStop", {"stopReason": stop_reason}),
                            _event("metadata", metadata),
                        ]
                    )
                    self._send(200, body, "application/vnd.amazon.eventstream")
                    return
                answer = {
                    "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
                    "stopReason": stop_reason,
                    **metadata,
                }
                self._send(200, json.dumps(answer).encode(), "application/json")
                return
            self._send(404, b"{}", "application/json")

    return Handler


def start_server(config_file: str, log_file: str, port: int = 0) -> tuple[ThreadingHTTPServer, int]:
    """Serve on 127.0.0.1 in a daemon thread; port 0 picks a free port."""
    server = FakeAwsServer(("127.0.0.1", port), _handler(config_file, log_file))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


if __name__ == "__main__":
    FakeAwsServer(("127.0.0.1", int(sys.argv[2])), _handler(sys.argv[1], sys.argv[3])).serve_forever()
