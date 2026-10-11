#!/usr/bin/env python3
"""Tests for TypeSafe System One client and config resolution.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.typesafe_client import (
    TypesafeHttpError,
    TypesafeTimeout,
    system_one,
)
from agenticx.llms.typesafe_config import (
    DEFAULT_TYPESAFE_BASE_URL,
    DEFAULT_TYPESAFE_MODEL,
    clamp_soft_timeout_sec,
    resolve_typesafe_api_key,
    load_typesafe_settings,
)


def _setup_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml")
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)


def test_resolve_typesafe_api_key_prefers_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    ConfigManager.set_value("typesafe.api_key", "cfg-key", scope="global")
    monkeypatch.setenv("TYPESAFE_API_KEY", "env-key")
    key_file = tmp_path / ".config" / "typesafe" / "key"
    key_file.parent.mkdir(parents=True)
    key_file.write_text("file-key\n", encoding="utf-8")
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config._typesafe_key_file",
        lambda: key_file,
    )
    assert resolve_typesafe_api_key() == "cfg-key"


def test_resolve_typesafe_api_key_env_then_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    monkeypatch.setenv("TYPESAFE_API_KEY", "env-key")
    key_file = tmp_path / "typesafe.key"
    key_file.write_text("file-key", encoding="utf-8")
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config._typesafe_key_file",
        lambda: key_file,
    )
    assert resolve_typesafe_api_key() == "env-key"
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    assert resolve_typesafe_api_key() == "file-key"


def test_resolve_typesafe_api_key_empty_when_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    monkeypatch.setattr(
        "agenticx.llms.typesafe_config._typesafe_key_file",
        lambda: tmp_path / "missing-key",
    )
    assert resolve_typesafe_api_key() == ""


def test_load_typesafe_settings_defaults(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_paths(tmp_path, monkeypatch)
    settings = load_typesafe_settings()
    assert settings.enabled is False
    assert settings.model == DEFAULT_TYPESAFE_MODEL
    assert settings.timeout_sec == 8
    assert settings.soft_timeout_sec == 2
    assert settings.group_routing is True
    assert settings.kb_auto is False
    assert settings.show_decision_card is True
    assert settings.act_above == 0.8
    assert settings.review_above == 0.5
    assert settings.has_key is False
    assert settings.base_url == DEFAULT_TYPESAFE_BASE_URL
    assert clamp_soft_timeout_sec(2, 8) == 2
    assert clamp_soft_timeout_sec(10, 8) == 8
    assert clamp_soft_timeout_sec(0, 8) == 2


@pytest.mark.asyncio
async def test_system_one_posts_state_and_bearer() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={"model": "jev-1.13.0", "answers": {"ok": {"type": "noul", "noul": 0.9}}},
        )

    transport = httpx.MockTransport(handler)
    result = await system_one(
        state={"document": "ping"},
        questions={"ok": {"type": "noul", "instructions": "Is this a connectivity probe?"}},
        model="jev-latest",
        api_key="sk-test",
        timeout_sec=8,
        transport=transport,
    )
    assert result["model"] == "jev-1.13.0"
    assert captured["url"] == "https://api.typesafe.ai/v1/systemone"
    assert captured["auth"] == "Bearer sk-test"
    body = captured["body"]
    assert isinstance(body, bytes)
    text = body.decode("utf-8")
    parsed = __import__("json").loads(text)
    assert "state" in parsed
    assert "questions" in parsed
    assert parsed["model"] == "jev-latest"


@pytest.mark.asyncio
async def test_system_one_401_not_retryable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "bad key"})

    with pytest.raises(TypesafeHttpError) as exc:
        await system_one(
            state="ping",
            questions={"ok": {"type": "noul", "instructions": "probe"}},
            model="jev-latest",
            api_key="bad",
            timeout_sec=8,
            transport=httpx.MockTransport(handler),
        )
    assert exc.value.status_code == 401
    assert exc.value.retryable is False


@pytest.mark.asyncio
async def test_system_one_429_retryable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "rate"})

    with pytest.raises(TypesafeHttpError) as exc:
        await system_one(
            state="ping",
            questions={"ok": {"type": "noul", "instructions": "probe"}},
            model="jev-latest",
            api_key="sk",
            timeout_sec=8,
            transport=httpx.MockTransport(handler),
        )
    assert exc.value.status_code == 429
    assert exc.value.retryable is True


@pytest.mark.asyncio
async def test_system_one_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            raise httpx.TimeoutException("deadline")

    monkeypatch.setattr("agenticx.llms.typesafe_client.httpx.AsyncClient", _Client)
    with pytest.raises(TypesafeTimeout):
        await system_one(
            state="ping",
            questions={"ok": {"type": "noul", "instructions": "probe"}},
            model="jev-latest",
            api_key="sk",
            timeout_sec=1,
        )
