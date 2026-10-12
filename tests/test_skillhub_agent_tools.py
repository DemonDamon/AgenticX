#!/usr/bin/env python3
"""Tests for the conversation-agent SkillHub tools (skillhub_install / skillhub_search).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession
from agenticx.extensions import skillhub_adapter
from agenticx.runtime.tool_search import CORE_ALWAYS_LOAD_TOOLS, is_deferred_builtin
from agenticx.runtime.truncated_final import detect_suspected_truncated_final


def _tool_names() -> set[str]:
    return {str(t.get("function", {}).get("name", "")) for t in agent_tools.STUDIO_TOOLS}


def test_skillhub_tools_registered_and_install_is_core() -> None:
    names = _tool_names()
    assert "skillhub_install" in names
    assert "skillhub_search" in names
    assert "skillhub_install" in CORE_ALWAYS_LOAD_TOOLS
    assert not is_deferred_builtin("skillhub_install")
    assert is_deferred_builtin("skillhub_search")


def test_skillhub_install_dispatch_success(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: Dict[str, Any] = {}

    def _fake_install(ref: str, **_kw: Any) -> Dict[str, Any]:
        calls["ref"] = ref
        return {
            "ok": True,
            "name": "tiangong-skill",
            "canonical": "@indiv-ebandao/tiangong-skill",
            "installed_path": "/tmp/registry/tiangong-skill/SKILL.md",
            "scan_summary": {"overall": "safe"},
        }

    monkeypatch.setattr(skillhub_adapter, "install_skillhub_skill", _fake_install)
    monkeypatch.setattr(agent_tools, "_refresh_skill_catalog_after_install", lambda: None)
    out = asyncio.run(
        agent_tools.dispatch_tool_async(
            "skillhub_install",
            {"ref": "@indiv-ebandao/tiangong-skill"},
            StudioSession(),
        )
    )
    payload = json.loads(out)
    assert calls["ref"] == "@indiv-ebandao/tiangong-skill"
    assert payload["ok"] is True
    assert payload["canonical"] == "@indiv-ebandao/tiangong-skill"
    assert payload["installed_path"].endswith("SKILL.md")


def test_skillhub_install_failure_steers_away_from_bash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        skillhub_adapter,
        "install_skillhub_skill",
        lambda ref, **_kw: {"ok": False, "error": "skill not found", "error_code": "skillhub_namespace_unresolved"},
    )
    out = asyncio.run(
        agent_tools.dispatch_tool_async("skillhub_install", {"ref": "nope"}, StudioSession())
    )
    payload = json.loads(out)
    assert payload["ok"] is False
    assert payload["error_code"] == "skillhub_namespace_unresolved"
    assert "bash_exec" in payload["next"]


def test_skillhub_install_requires_ref() -> None:
    out = asyncio.run(agent_tools.dispatch_tool_async("skillhub_install", {"ref": " "}, StudioSession()))
    assert out.startswith("ERROR")


def test_skillhub_search_trims_results(monkeypatch: pytest.MonkeyPatch) -> None:
    items = [
        {
            "slug": f"s{i}",
            "name": f"S{i}",
            "canonical": f"@ns/s{i}",
            "downloads": i,
            "description": "first line\nsecond line",
        }
        for i in range(12)
    ]
    monkeypatch.setattr(
        skillhub_adapter,
        "search_skillhub_market",
        lambda q: {"ok": True, "items": items, "source": "skillhub_api"},
    )
    out = asyncio.run(
        agent_tools.dispatch_tool_async("skillhub_search", {"query": "视频", "limit": 5}, StudioSession())
    )
    payload = json.loads(out)
    assert payload["count"] == 5
    assert payload["items"][0]["canonical"] == "@ns/s0"
    assert payload["items"][0]["description"] == "first line"


def test_fetch_lead_in_without_tool_call_is_retried() -> None:
    """Live session: reasoning 'Fetch the install doc.' + body '我先获取该安装说明', no tool call."""
    signal = detect_suspected_truncated_final(
        visible_body="我先获取该安装说明",
        reasoning_text="Fetch the install doc.",
        had_tool_calls_this_round=False,
        executed_tool_names=[],
        finish_reason="unknown",
    )
    assert signal == "short_unterminated_with_intent"


class _FakeHub:
    def __init__(self, content: str | None, err: str = "") -> None:
        self._registries = [{"name": "agx", "type": "agx"}, {"name": "clawhub", "type": "clawhub"}]
        self._content = content
        self._err = err
        self.fetched: list[tuple[str, str]] = []
        self.written: list[str] = []

    def fetch_skill_markdown(self, source: str, name: str):
        self.fetched.append((source, name))
        return self._content, self._err

    def write_registry_skill(self, name: str, content: str):
        self.written.append(name)
        return f"/tmp/registry/{name}/SKILL.md"


def test_clawhub_install_defaults_to_clawhub_source(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.extensions import registry_hub

    hub = _FakeHub("---\nname: archify\ndescription: d\n---\n# Archify\n")
    monkeypatch.setattr(registry_hub.RegistryHub, "from_config", classmethod(lambda cls: hub))
    monkeypatch.setattr(agent_tools, "_refresh_skill_catalog_after_install", lambda: None)
    out = asyncio.run(agent_tools.dispatch_tool_async("clawhub_install", {"name": "archify"}, StudioSession()))
    payload = json.loads(out)
    assert payload["ok"] is True
    assert hub.fetched == [("clawhub", "archify")]
    assert hub.written == ["archify"]
    assert "clawhub_install" in CORE_ALWAYS_LOAD_TOOLS


def test_clawhub_install_fetch_error_does_not_write(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.extensions import registry_hub

    hub = _FakeHub(None, "Failed to fetch skill")
    monkeypatch.setattr(registry_hub.RegistryHub, "from_config", classmethod(lambda cls: hub))
    out = asyncio.run(
        agent_tools.dispatch_tool_async("clawhub_install", {"name": "x", "source": "clawhub"}, StudioSession())
    )
    payload = json.loads(out)
    assert payload["ok"] is False
    assert hub.written == []
    assert "bash_exec" in payload["next"]


def test_high_risk_ack_requires_prior_refusal_and_new_user_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    acks: list[bool] = []

    def _fake_install(ref: str, *, acknowledge_high_risk: bool = False) -> Dict[str, Any]:
        acks.append(acknowledge_high_risk)
        if not acknowledge_high_risk:
            return {"ok": False, "error": "high_risk_confirm_required", "error_code": "high_risk_confirm_required"}
        return {"ok": True, "name": "zhongkui-skill", "canonical": "@indiv-ebandao/zhongkui-skill"}

    monkeypatch.setattr(skillhub_adapter, "install_skillhub_skill", _fake_install)
    monkeypatch.setattr(agent_tools, "_refresh_skill_catalog_after_install", lambda: None)
    session = StudioSession()
    session.agent_messages = [{"role": "user", "content": "安装 @indiv-ebandao/zhongkui-skill"}]
    call = lambda args: json.loads(  # noqa: E731
        asyncio.run(agent_tools.dispatch_tool_async("skillhub_install", args, session))
    )

    # Model sets acknowledge up front without any refusal: not honored.
    first = call({"ref": "@indiv-ebandao/zhongkui-skill", "acknowledge_high_risk": True})
    assert first["ok"] is False and "acknowledge_high_risk=true" in first["next"]
    # Same turn, retried with acknowledge: still no new user reply → not honored.
    second = call({"ref": "@indiv-ebandao/zhongkui-skill", "acknowledge_high_risk": True})
    assert second["ok"] is False
    # User replies, then acknowledge is honored.
    session.agent_messages.append({"role": "user", "content": "确认，仍然安装"})
    third = call({"ref": "@indiv-ebandao/zhongkui-skill", "acknowledge_high_risk": True})
    assert third["ok"] is True
    assert acks == [False, False, True]
