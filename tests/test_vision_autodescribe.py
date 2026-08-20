#!/usr/bin/env python3
"""当前模型看不见图片时的自动解读，以及视觉兜底模型的选取顺序。"""

from __future__ import annotations

import pytest

from agenticx.studio.vision_autodescribe import describe_turn_images

PNG = "data:image/png;base64,iVBORw0KGgo="
ROUTING = {
    "enabled": True,
    "documentTarget": {
        "id": "qwen_local/qwen3.8-27b",
        "provider": "qwen_local",
        "model": "qwen3.8-27b",
        "label": "本地推理/Qwen3.8 27B",
    },
    "documentExtensions": [".pdf"],
    "visionFallback": {
        "id": "qwen_local/qwen3.8-27b",
        "provider": "qwen_local",
        "model": "qwen3.8-27b",
        "label": "本地推理/Qwen3.8 27B",
    },
    "maxRenderedPages": 20,
}


class _Session:
    def __init__(self, provider="zhipu", model="glm-5.2"):
        self.provider_name = provider
        self.model_name = model


class _Resp:
    def __init__(self, content):
        self.content = content


class _LLM:
    def __init__(self, reply="截图里是一个 500 报错页面。", fail=False):
        self.reply = reply
        self.fail = fail
        self.calls = 0

    async def ainvoke(self, messages):
        self.calls += 1
        if self.fail:
            raise RuntimeError("boom")
        return _Resp(self.reply)


@pytest.fixture
def fallback(monkeypatch):
    llm = _LLM()
    monkeypatch.setattr(
        "agenticx.llms.vision_fallback.resolve_vision_fallback",
        lambda session=None: {
            "available": True,
            "provider": "qwen_local",
            "model": "qwen3.8-27b",
            "label": "本地推理/Qwen3.8 27B",
        },
    )
    monkeypatch.setattr(
        "agenticx.llms.provider_resolver.ProviderResolver.resolve",
        staticmethod(lambda **_kw: llm),
    )
    return llm


@pytest.mark.asyncio
async def test_describes_this_turn_images(fallback):
    out = await describe_turn_images(_Session(), [{"name": "报错.png", "data_url": PNG}])
    assert "图片解读" in out
    assert "报错.png" in out and "500 报错页面" in out
    # 说清原图没出去，也别让模型说"我看不到图片"。
    assert "原图未离开私有部署" in out
    assert fallback.calls == 1


@pytest.mark.asyncio
async def test_ignores_non_image_attachments(fallback):
    out = await describe_turn_images(
        _Session(), [{"name": "a.pdf", "data_url": "data:application/pdf;base64,xx"}, "junk"]
    )
    assert out == "" and fallback.calls == 0


@pytest.mark.asyncio
async def test_caps_how_many_images_get_described(fallback):
    rows = [{"name": f"{i}.png", "data_url": PNG} for i in range(10)]
    await describe_turn_images(_Session(), rows)
    assert fallback.calls == 4


@pytest.mark.asyncio
async def test_runs_images_concurrently(fallback, monkeypatch):
    """串行会把首 token 前的等待直接乘上张数。"""
    import asyncio

    inflight = {"now": 0, "peak": 0}

    async def _slow(_messages):
        inflight["now"] += 1
        inflight["peak"] = max(inflight["peak"], inflight["now"])
        await asyncio.sleep(0.05)
        inflight["now"] -= 1
        return _Resp("ok")

    monkeypatch.setattr(fallback, "ainvoke", _slow)
    await describe_turn_images(_Session(), [{"name": f"{i}.png", "data_url": PNG} for i in range(4)])
    assert inflight["peak"] > 1


@pytest.mark.asyncio
async def test_falls_back_to_silence_when_the_vision_call_fails(monkeypatch):
    """一次视觉调用失败不该挡住整轮对话——调用方会退回原来那句提示。"""
    monkeypatch.setattr(
        "agenticx.llms.vision_fallback.resolve_vision_fallback",
        lambda session=None: {
            "available": True,
            "provider": "p",
            "model": "m",
            "label": "L",
        },
    )
    monkeypatch.setattr(
        "agenticx.llms.provider_resolver.ProviderResolver.resolve",
        staticmethod(lambda **_kw: _LLM(fail=True)),
    )
    out = await describe_turn_images(_Session(), [{"name": "a.png", "data_url": PNG}])
    assert out == ""


@pytest.mark.asyncio
async def test_silent_when_no_fallback_model_is_available(monkeypatch):
    monkeypatch.setattr(
        "agenticx.llms.vision_fallback.resolve_vision_fallback",
        lambda session=None: {"available": False, "provider": "", "model": "", "label": ""},
    )
    out = await describe_turn_images(_Session(), [{"name": "a.png", "data_url": PNG}])
    assert out == ""


# --------------------------------------------------------------------------
# 兜底模型的选取顺序
# --------------------------------------------------------------------------
def _use_routing_policy(monkeypatch, raw):
    from agenticx.studio import attachment_routing

    monkeypatch.setattr(
        attachment_routing, "_load_from_global_config", lambda: raw, raising=False
    )


def test_routing_policy_outranks_local_vision_fallback_config(monkeypatch):
    """本地 config 里放一个别的 vision_fallback 就能把截图送去公网，那这条路就白设了。"""
    from agenticx.cli.config_manager import ConfigManager
    from agenticx.llms.vision_fallback import resolve_vision_fallback

    _use_routing_policy(monkeypatch, ROUTING)
    monkeypatch.setattr(
        ConfigManager,
        "get_value",
        staticmethod(
            lambda key, default=None: {"provider": "openai", "model": "gpt-4o"}
            if key == "vision_fallback"
            else default
        ),
    )
    info = resolve_vision_fallback(session=_Session())
    assert info["available"] and info["provider"] == "qwen_local"


def test_enterprise_sessions_get_the_full_id(monkeypatch):
    from agenticx.llms.vision_fallback import resolve_vision_fallback

    _use_routing_policy(monkeypatch, ROUTING)
    info = resolve_vision_fallback(session=_Session(provider="enterprise", model="zhipu/glm-5.2"))
    assert info["provider"] == "enterprise"
    assert info["model"] == "qwen_local/qwen3.8-27b"


def test_local_config_still_wins_when_routing_is_off(monkeypatch):
    """没接企业的用法不受影响。"""
    from agenticx.cli.config_manager import ConfigManager
    from agenticx.llms.vision_fallback import resolve_vision_fallback

    _use_routing_policy(monkeypatch, {})
    monkeypatch.setattr(
        ConfigManager,
        "get_value",
        staticmethod(
            lambda key, default=None: {"provider": "zhipu", "model": "glm-4.6v"}
            if key == "vision_fallback"
            else default
        ),
    )
    info = resolve_vision_fallback(session=_Session())
    assert info["provider"] == "zhipu" and info["model"] == "glm-4.6v"
