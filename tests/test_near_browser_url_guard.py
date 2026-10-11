#!/usr/bin/env python3
"""Tests for near_browser URL guard and session profile stability.

Author: Damon Li
"""

from __future__ import annotations

import sys
from pathlib import Path as _Path

# Prefer this worktree's package over an editable install of another checkout.
_ROOT = _Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import asyncio
import json
from pathlib import Path
from typing import List

import pytest

from agenticx.tools.near_browser.profile import get_or_create_browser_profile_id
from agenticx.tools.near_browser.url_guard import (
    UrlGuardError,
    is_public_ip,
    validate_public_http_url,
)


def _public_resolve(_hostname: str) -> List[str]:
    return ["93.184.216.34"]


def _mixed_private_resolve(_hostname: str) -> List[str]:
    return ["1.1.1.1", "127.0.0.1"]


@pytest.mark.parametrize(
    "address,expected",
    [
        ("8.8.8.8", True),
        ("1.1.1.1", True),
        ("93.184.216.34", True),
        ("127.0.0.1", False),
        ("10.0.0.1", False),
        ("192.168.1.1", False),
        ("169.254.1.1", False),
        ("172.16.0.1", False),
        ("0.0.0.0", False),
        ("::1", False),
        ("fc00::1", False),
        ("fe80::1", False),
        ("2001:db8::1", False),
        ("2606:4700:4700::1111", True),
    ],
)
def test_is_public_ip_matrix(address: str, expected: bool) -> None:
    assert is_public_ip(address) is expected


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1",
        "http://127.0.0.1/",
        "https://10.0.0.1/path",
        "http://192.168.0.5",
        "http://169.254.169.254/latest/meta-data",
        "http://localhost",
        "http://localhost.",
        "http://host.local",
        "http://app.internal",
        "file:///etc/passwd",
        "data:text/html,hello",
        "javascript:alert(1)",
        "https://user:password@example.com",
        "http://example.com:22",
        "http://2130706433",
        "http://0x7f000001",
        "http://0177.0.0.1",
        "http://127.1",
        "http://[::ffff:127.0.0.1]",
    ],
)
def test_private_and_dangerous_urls_blocked(url: str) -> None:
    with pytest.raises(UrlGuardError) as exc_info:
        validate_public_http_url(url, resolve=_public_resolve)
    err = exc_info.value
    assert err.code == "BLOCKED_URL"
    assert "不允许" in err.message or "仅允许" in err.message


def test_dns_answer_with_any_private_blocked() -> None:
    with pytest.raises(UrlGuardError) as exc_info:
        validate_public_http_url("https://example.com", resolve=_mixed_private_resolve)
    assert exc_info.value.code == "BLOCKED_URL"
    assert "内网" in exc_info.value.message


def test_public_url_ok() -> None:
    result = validate_public_http_url(
        "https://example.com/a",
        resolve=_public_resolve,
    )
    assert result.address == "93.184.216.34"
    assert result.hostname == "example.com"
    assert result.url.startswith("https://example.com/a")


def test_public_ip_literal_ok() -> None:
    result = validate_public_http_url("https://1.1.1.1/")
    assert result.address == "1.1.1.1"
    assert result.family == 4


def test_profile_stable_per_session(tmp_path: Path) -> None:
    sid = "sess-profile-stable"
    first = get_or_create_browser_profile_id(sid, sessions_root=tmp_path)
    second = get_or_create_browser_profile_id(sid, sessions_root=tmp_path)
    other = get_or_create_browser_profile_id("sess-other", sessions_root=tmp_path)
    assert first == second
    assert first != other
    stored = json.loads((tmp_path / sid / "browser_profile.json").read_text(encoding="utf-8"))
    assert stored["profile_id"] == first


def test_near_browser_open_rejects_private_before_bridge(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.cli import agent_tools

    called = {"http": False}

    async def _fake_http(*_a, **_k):
        called["http"] = True
        return '{"ok": true}'

    monkeypatch.setattr(agent_tools, "_tool_near_browser_http", _fake_http)

    class _Session:
        _session_id = "sess-guard"
        session_id = "sess-guard"

    async def _run() -> None:
        result = await agent_tools._tool_near_browser_open(
            {"url": "http://127.0.0.1"},
            _Session(),
        )
        assert result.startswith("ERROR:")
        assert "内网" in result or "不允许" in result
        assert called["http"] is False

    asyncio.run(_run())


def test_near_browser_open_returns_profile_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.cli import agent_tools

    monkeypatch.setenv("AGX_SESSIONS_ROOT", str(tmp_path))

    async def _fake_http(_session, action, payload=None, *, timeout_sec):
        assert action == "open"
        assert payload is not None
        assert payload.get("url") == "https://example.com/"
        assert payload.get("profile_id")
        return json.dumps({"ok": True, "url": payload["url"]})

    monkeypatch.setattr(agent_tools, "_tool_near_browser_http", _fake_http)
    monkeypatch.setattr(
        "agenticx.tools.near_browser.url_guard.validate_public_http_url",
        lambda url, resolve=None: type(
            "V",
            (),
            {
                "url": url,
                "hostname": "example.com",
                "address": "93.184.216.34",
                "family": 4,
            },
        )(),
    )

    class _Session:
        _session_id = "sess-open-profile"
        session_id = "sess-open-profile"

    async def _run() -> None:
        result = await agent_tools._tool_near_browser_open(
            {"url": "https://example.com/"},
            _Session(),
        )
        payload = json.loads(result)
        assert payload.get("ok") is True
        assert payload.get("profile_id")
        again = await agent_tools._tool_near_browser_open(
            {"url": "https://example.com/"},
            _Session(),
        )
        assert json.loads(again)["profile_id"] == payload["profile_id"]

    asyncio.run(_run())
