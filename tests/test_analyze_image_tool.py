#!/usr/bin/env python3
"""Tests for analyze_image vision fallback tool.

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession


PNG_1X1_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class _FakeVisionLLM:
    def __init__(self) -> None:
        self.messages: List[Dict[str, Any]] = []

    async def ainvoke(self, messages, **_kwargs):
        self.messages = list(messages)
        return SimpleNamespace(content="图中是某组织 Logo")


def _data_url() -> str:
    return f"data:image/png;base64,{PNG_1X1_B64}"


@pytest.mark.asyncio
async def test_analyze_image_text_session_sends_image_url(monkeypatch) -> None:
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-5.2"
    fake = _FakeVisionLLM()
    monkeypatch.setattr(
        "agenticx.llms.vision_fallback.resolve_vision_fallback",
        lambda session=None: {
            "available": True,
            "provider": "zhipu",
            "model": "glm-4.6v",
            "label": "智谱开放平台/glm-4.6v",
        },
    )
    monkeypatch.setattr(
        "agenticx.llms.provider_resolver.ProviderResolver.resolve",
        classmethod(lambda cls, provider_name=None, model=None: fake),
    )
    result = await agent_tools._tool_analyze_image(
        {"target": _data_url(), "question": "识别组织"},
        session,
    )
    assert "图中是某组织 Logo" in result
    assert fake.messages
    content = fake.messages[0]["content"]
    assert isinstance(content, list)
    assert any(
        isinstance(block, dict) and block.get("type") == "image_url" for block in content
    )


@pytest.mark.asyncio
async def test_analyze_image_rejects_vision_session() -> None:
    session = StudioSession()
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    result = await agent_tools._tool_analyze_image({"target": _data_url()}, session)
    assert result.startswith("ERROR:")
    assert "view_image" in result


@pytest.mark.asyncio
async def test_analyze_image_requires_fallback_config(monkeypatch) -> None:
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-5.2"
    monkeypatch.setattr(
        "agenticx.llms.vision_fallback.resolve_vision_fallback",
        lambda session=None: {
            "available": False,
            "provider": "",
            "model": "",
            "label": "",
        },
    )
    result = await agent_tools._tool_analyze_image({"target": _data_url()}, session)
    assert "vision_fallback" in result
    assert "模型服务" in result


@pytest.mark.asyncio
async def test_analyze_image_omitted_target_uses_latest_attachment(monkeypatch) -> None:
    session = StudioSession()
    session.provider_name = "zhipu"
    session.model_name = "glm-5.2"
    session.chat_history = [
        {
            "role": "user",
            "content": "查下这个组织",
            "attachments": [
                {
                    "name": "org.png",
                    "mime_type": "image/png",
                    "data_url": _data_url(),
                }
            ],
        }
    ]
    fake = _FakeVisionLLM()
    monkeypatch.setattr(
        "agenticx.llms.vision_fallback.resolve_vision_fallback",
        lambda session=None: {
            "available": True,
            "provider": "zhipu",
            "model": "glm-4.6v",
            "label": "智谱开放平台/glm-4.6v",
        },
    )
    monkeypatch.setattr(
        "agenticx.llms.provider_resolver.ProviderResolver.resolve",
        classmethod(lambda cls, provider_name=None, model=None: fake),
    )
    result = await agent_tools._tool_analyze_image({}, session)
    assert "图中是某组织 Logo" in result
    assert "org.png" in result
