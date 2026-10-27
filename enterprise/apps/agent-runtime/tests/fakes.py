#!/usr/bin/env python3
"""In-process stand-ins for admin-console and the enterprise gateway.

Author: Damon Li
"""

from __future__ import annotations

import json
import socket
import threading
import time
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

DEFAULT_MANIFEST: dict[str, Any] = {
    "schema": "agx.agent/v1",
    "model": "demo/reply-model",
    "system": "you are a test agent",
    "tools": [{"type": "agx_builtin", "default_policy": "always_allow"}],
}

_DESKTOP_PATS: dict[str, dict[str, Any]] = {
    "agx-pat-dev-a": {
        "active": True,
        "tenant_id": "T",
        "user_id": "UA",
        "scopes": ["workspace:chat", "desktop:managed"],
    },
    "agx-pat-dev-b": {
        "active": True,
        "tenant_id": "T",
        "user_id": "UB",
        "scopes": ["workspace:chat", "desktop:managed"],
    },
}


def agent_record(
    agent_id: str,
    tenant_id: str,
    latest_version: int,
    *,
    default_environment_id: str | None = None,
) -> dict[str, Any]:
    return {
        "id": agent_id,
        "tenant_id": tenant_id,
        "slug": "agent",
        "display_name": "Agent",
        "description": None,
        "latest_version": latest_version,
        "status": "active",
        "lifecycle": "published",
        "origin": "enterprise",
        "assignment_keys": [],
        "worker_keys": [],
        "default_environment_id": default_environment_id,
    }


def version_record(
    agent_id: str,
    version: int,
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "agent_id": agent_id,
        "version": version,
        "manifest": manifest or DEFAULT_MANIFEST,
        "manifest_hash": f"hash-v{version}",
        "created_by": None,
        "created_at": "2026-10-25T00:00:00.000Z",
        "note": None,
    }


class FakeAdminConsole:
    """httpx mock of the internal managed-agent routes."""

    def __init__(
        self,
        *,
        agents: dict[str, dict[str, Any]] | None = None,
        environments: dict[str, dict[str, Any]] | None = None,
        pats: dict[str, dict[str, Any]] | None = None,
        worker_eligibility: dict[tuple[str, str], dict[str, Any]] | None = None,
        status_code: int | None = None,
    ) -> None:
        self.agents = agents or {}
        self.environments = environments or {}
        self.pats = dict(_DESKTOP_PATS)
        if pats:
            self.pats.update(pats)
        self.worker_eligibility = worker_eligibility or {}
        self.schedules: list[dict[str, Any]] = []
        self.disabled_ids: list[str] = []
        self.webhooks: list[dict[str, Any]] = []
        self.expiring: list[dict[str, Any]] = []
        self.channels: list[dict[str, Any]] = []
        self.channel_secrets: dict[str, dict[str, str]] = {}
        self.status_code = status_code
        self.requests: list[httpx.Request] = []
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status_code is not None:
            return httpx.Response(self.status_code, json={"error": "forced"})
        path = request.url.path
        if path.startswith("/api/internal/ma/agent-versions/"):
            return self._agent_version(path)
        if path.startswith("/api/internal/ma/environments/"):
            env_id = path.rstrip("/").rsplit("/", 1)[-1]
            environment = self.environments.get(env_id)
            if environment is None:
                return httpx.Response(404, json={"error": "not found"})
            return httpx.Response(200, json={"environment": environment})
        if path.endswith("/pat-introspect"):
            payload = json.loads(request.content.decode("utf-8") or "{}")
            token = payload.get("token")
            body = self.pats.get(str(token), {"active": False})
            return httpx.Response(200, json=body)
        if path == "/api/internal/ma/schedules":
            return httpx.Response(
                200,
                json={"data": self.schedules, "disabled_ids": self.disabled_ids},
            )
        if path == "/api/internal/ma/webhooks":
            return httpx.Response(200, json={"data": self.webhooks})
        if path == "/api/internal/ma/credentials/expiring":
            return httpx.Response(200, json={"data": self.expiring})
        if path == "/api/internal/ma/channels":
            return httpx.Response(200, json={"data": self.channels})
        if path.startswith("/api/internal/ma/channels/") and path.endswith("/credential"):
            channel_id = path.strip("/").split("/")[-2]
            secret = self.channel_secrets.get(channel_id)
            if secret is None:
                return httpx.Response(404, json={"error": {"code": "channel_not_found", "message": "channel not found"}})
            return httpx.Response(200, json=secret)
        if path.endswith("/worker-eligibility"):
            tenant_id = request.url.params.get("tenant_id") or ""
            user_id = request.url.params.get("user_id") or ""
            body = self.worker_eligibility.get((tenant_id, user_id))
            if body is None:
                body = {"user_id": user_id, "assignment_keys": [], "environments": []}
            return httpx.Response(200, json=body)
        return httpx.Response(404, json={"error": "not found"})

    def _agent_version(self, path: str) -> httpx.Response:
        rest = path[len("/api/internal/ma/agent-versions/") :]
        agent_id, _, selector = rest.partition("/")
        bundle = self.agents.get(agent_id)
        if bundle is None:
            return httpx.Response(404, json={"error": "not found"})
        versions: dict[int, dict[str, Any]] = bundle["versions"]
        if selector == "effective":
            number = int(bundle["effective"])
        elif selector == "latest":
            number = max(versions)
        elif selector.isdigit():
            number = int(selector)
        else:
            return httpx.Response(404, json={"error": "not found"})
        record = versions.get(number)
        if record is None:
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(
            200,
            json={
                "agent": bundle["agent"],
                "routing": {"selector": selector},
                "runtime": bundle.get("runtime", "cloud"),
                "version": record,
            },
        )


def _sse(item: dict[str, Any]) -> Any:
    if "tool" in item:
        first = {
            "id": "chatcmpl-test",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "reply-model",
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_tool_1",
                                "type": "function",
                                "function": {
                                    "name": item["tool"],
                                    "arguments": json.dumps(item.get("arguments") or {}),
                                },
                            }
                        ],
                    },
                    "finish_reason": None,
                }
            ],
        }
        done = {
            "id": "chatcmpl-test",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "reply-model",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
        }
        chunks = (first, done)
    else:
        text = str(item.get("text") or "")
        first = {
            "id": "chatcmpl-test",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "reply-model",
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", "content": text},
                    "finish_reason": None,
                }
            ],
        }
        done = {
            "id": "chatcmpl-test",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "reply-model",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
        }
        chunks = (first, done)

    def generate() -> Any:
        for chunk in chunks:
            yield f"data: {json.dumps(chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return generate()


def _completion(item: dict[str, Any]) -> dict[str, Any]:
    if "tool" in item:
        message: dict[str, Any] = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_tool_1",
                    "type": "function",
                    "function": {
                        "name": item["tool"],
                        "arguments": json.dumps(item.get("arguments") or {}),
                    },
                }
            ],
        }
        finish = "tool_calls"
    else:
        message = {"role": "assistant", "content": str(item.get("text") or "")}
        finish = "stop"
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 0,
        "model": "reply-model",
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
    }


class FakeGateway:
    """Local OpenAI-compatible server used by gateway and end-to-end tests."""

    def __init__(self, script: list[dict[str, Any]]) -> None:
        self.script = script or [{"text": "ok"}]
        self.calls: list[dict[str, Any]] = []
        self._index = 0
        self._lock = threading.Lock()
        app = FastAPI()

        @app.post("/v1/chat/completions")
        async def completions(request: Request) -> Any:
            payload = await request.json()
            with self._lock:
                item = self.script[min(self._index, len(self.script) - 1)]
                self._index += 1
                self.calls.append(
                    {
                        "headers": {key.lower(): value for key, value in request.headers.items()},
                        "body": payload,
                    }
                )
            if payload.get("stream"):
                return StreamingResponse(_sse(item), media_type="text/event-stream")
            return JSONResponse(_completion(item))

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        self.port = sock.getsockname()[1]
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


__all__ = [
    "DEFAULT_MANIFEST",
    "FakeAdminConsole",
    "FakeGateway",
    "agent_record",
    "version_record",
]
