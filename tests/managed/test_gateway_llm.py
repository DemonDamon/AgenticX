#!/usr/bin/env python3
"""Gateway header injection against a local OpenAI-compatible server.

Author: Damon Li
"""

from __future__ import annotations

import json
import socket
import threading
import time
from typing import Any

import pytest
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from agenticx.managed.gateway_llm import GatewayLLMFactory
from agenticx.managed.llm import LLMCallContext

_SESSION = "01JABCDEFGHJKMNPQRSTVWXYZ0"
_AGENT = "01JAGENTAAAAAAAAAAAAAAAAAA"


class _FakeGateway:
    """Minimal chat-completions server. A copy lives here so framework tests stay standalone."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        app = FastAPI()

        @app.post("/v1/chat/completions")
        async def completions(request: Request) -> Any:
            payload = await request.json()
            self.calls.append(
                {
                    "headers": {key.lower(): value for key, value in request.headers.items()},
                    "body": payload,
                }
            )
            if payload.get("stream"):
                return StreamingResponse(_stream("stream-ok"), media_type="text/event-stream")
            return JSONResponse(_message("invoke-ok"))

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        self.port = int(sock.getsockname()[1])
        sock.close()
        self.base_url = f"http://127.0.0.1:{self.port}"
        self._server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning")
        )
        self._thread = threading.Thread(target=self._server.run, daemon=True)

    def start(self) -> None:
        self._thread.start()
        for _ in range(100):
            if self._server.started:
                return
            time.sleep(0.05)
        raise RuntimeError("fake gateway did not start")

    def close(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=5)


def _message(text: str) -> dict[str, Any]:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 0,
        "model": "reply-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def _stream(text: str) -> Any:
    chunk = {
        "id": "chatcmpl-test",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "reply-model",
        "choices": [
            {"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}
        ],
    }
    done = {
        "id": "chatcmpl-test",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "reply-model",
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    }

    def generate() -> Any:
        yield f"data: {json.dumps(chunk)}\n\n"
        yield f"data: {json.dumps(done)}\n\n"
        yield "data: [DONE]\n\n"

    return generate()


@pytest.fixture
def gateway() -> Any:
    server = _FakeGateway()
    server.start()
    try:
        yield server
    finally:
        server.close()


def _factory(gateway: _FakeGateway) -> GatewayLLMFactory:
    return GatewayLLMFactory(base_url=gateway.base_url + "/v1", token="agx-pat-test") # gitleaks:allow


def _context() -> LLMCallContext:
    return LLMCallContext(
        tenant_id="t",
        session_id=_SESSION,
        agent_id=_AGENT,
        agent_version=2,
    )


def _assert_headers(call: dict[str, Any], *, step: str) -> None:
    headers = call["headers"]
    assert headers["authorization"] == "Bearer agx-pat-test"
    assert headers["x-agenticx-provider"] == "demo"
    assert headers["x-agenticx-trace-id"] == _SESSION.lower()
    assert headers["x-agenticx-trace-step"] == step
    assert headers["x-agenticx-trace-stage"] == "ma.session"
    assert headers["x-agenticx-session-id"] == _SESSION
    assert headers["x-agenticx-agent-id"] == _AGENT
    assert headers["x-agenticx-deployment-id"] == f"ma-{_AGENT}-v2"
    assert call["body"]["model"] == "reply-model"


def test_invoke_sends_gateway_headers(gateway: _FakeGateway) -> None:
    provider = _factory(gateway).create(provider="demo", model="reply-model", context=_context())
    provider.invoke([{"role": "user", "content": "hi"}])
    provider.invoke([{"role": "user", "content": "again"}])
    assert len(gateway.calls) == 2
    _assert_headers(gateway.calls[0], step="1")
    _assert_headers(gateway.calls[1], step="2")


def test_stream_with_tools_sends_headers(gateway: _FakeGateway) -> None:
    provider = _factory(gateway).create(provider="demo", model="reply-model", context=_context())
    chunks = list(provider.stream_with_tools([{"role": "user", "content": "hi"}]))
    assert chunks
    _assert_headers(gateway.calls[0], step="1")


def test_repr_hides_token(gateway: _FakeGateway) -> None:
    factory = _factory(gateway)
    assert "agx-pat-test" not in repr(factory)
