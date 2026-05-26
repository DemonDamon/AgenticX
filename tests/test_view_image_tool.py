#!/usr/bin/env python3
"""Tests for view_image tool.

Author: Damon Li
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class _FakeResponse:
    def __init__(self, *, content: bytes, content_type: str = "image/png", url: str = "https://img.example/a.png") -> None:
        self.status_code = 200
        self.content = content
        self.headers = {"content-type": content_type}
        self.url = url


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url: str):
        return self._response


@pytest.mark.asyncio
async def test_view_image_data_url(tmp_path: Path) -> None:
    session = StudioSession()
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    data_url = agent_tools._data_url_from_bytes(PNG_1X1, "image/png")
    result = await agent_tools._tool_view_image({"target": data_url}, session)
    assert result.startswith("[image loaded:")
    pending = session.scratchpad[agent_tools.PENDING_VISUAL_ATTACHMENTS_KEY]
    assert len(pending) == 1
    assert pending[0]["data_url"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_view_image_local_path(tmp_path: Path, monkeypatch) -> None:
    image_path = tmp_path / "demo.png"
    image_path.write_bytes(PNG_1X1)
    session = StudioSession()
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    monkeypatch.setattr(agent_tools, "_desktop_unrestricted_fs_enabled", lambda: True)
    result = await agent_tools._tool_view_image({"target": str(image_path)}, session)
    assert result.startswith("[image loaded:")
    assert len(session.scratchpad[agent_tools.PENDING_VISUAL_ATTACHMENTS_KEY]) == 1


@pytest.mark.asyncio
async def test_view_image_https_url(monkeypatch) -> None:
    session = StudioSession()
    session.provider_name = "openai"
    session.model_name = "gpt-4o"

    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            return _FakeResponse(content=PNG_1X1)

    monkeypatch.setattr("httpx.AsyncClient", _Client)
    result = await agent_tools._tool_view_image({"target": "https://img.example/a.png"}, session)
    assert result.startswith("[image loaded:")
    assert session.scratchpad[agent_tools.PENDING_VISUAL_ATTACHMENTS_KEY][0]["source"] == "https://img.example/a.png"


@pytest.mark.asyncio
async def test_view_image_rejects_non_vision_model() -> None:
    session = StudioSession()
    session.provider_name = "minimax"
    session.model_name = "MiniMax-M2"
    data_url = agent_tools._data_url_from_bytes(PNG_1X1, "image/png")
    result = await agent_tools._tool_view_image({"target": data_url}, session)
    assert "does not support vision" in result
    assert agent_tools.PENDING_VISUAL_ATTACHMENTS_KEY not in session.scratchpad


@pytest.mark.asyncio
async def test_view_image_pending_limit() -> None:
    session = StudioSession()
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    data_url = agent_tools._data_url_from_bytes(PNG_1X1, "image/png")
    for _ in range(4):
        ok = await agent_tools._tool_view_image({"target": data_url}, session)
        assert ok.startswith("[image loaded:")
    blocked = await agent_tools._tool_view_image({"target": data_url}, session)
    assert blocked == "ERROR: too many pending visual attachments (max 4 per turn)"


@pytest.mark.asyncio
async def test_view_image_rejects_oversized_local_file(tmp_path: Path, monkeypatch) -> None:
    image_path = tmp_path / "big.png"
    image_path.write_bytes(b"x" * (agent_tools._VIEW_IMAGE_MAX_BYTES + 1))
    session = StudioSession()
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    monkeypatch.setattr(agent_tools, "_desktop_unrestricted_fs_enabled", lambda: True)
    result = await agent_tools._tool_view_image({"target": str(image_path)}, session)
    assert result == "ERROR: image exceeds 8MB limit"
