#!/usr/bin/env python3
"""Tool-dispatch tests for enterprise_agent_builder.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from agenticx.cli.agent_tools import STUDIO_TOOLS, _tool_enterprise_agent_builder
from agenticx.managed.spec import MANAGED_BUILTIN_TOOLS
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.enterprise_agent_builder import (
    NOT_LOGGED_IN_TEXT,
    DraftSummary,
    PreviewReport,
)
from agenticx.runtime.tool_search import BUILTIN_DEFER_ALLOWLIST, is_deferred_builtin
from agenticx.tools.skill_bundle import (
    SkillBundleLoader,
    _SKILL_PACKAGE_SKILLS_DIR,
    infer_skill_source,
)


class _Gate(ConfirmGate):
    def __init__(self, approved: bool = False) -> None:
        self.approved = approved
        self.questions: list[str] = []

    async def request_confirm(self, question: str, context: dict | None = None) -> bool:
        self.questions.append(question)
        return self.approved


def _logged_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.enterprise_publish_settings",
        lambda: ("agx-pat-x", "https://portal.example"),
    )
    monkeypatch.setattr(
        "agenticx.cli.agent_tools.tool_allowed_without_confirm",
        lambda *_args: False,
    )


def _summary(agent_id: str = "ag-1", lifecycle: str = "draft") -> DraftSummary:
    return DraftSummary(
        agent_id=agent_id,
        display_name="销售周报",
        description=None,
        local_avatar_id="nl-sales",
        lifecycle=lifecycle,
        latest_version=1,
        effective_version=1,
        routing_mode="follow_latest",
        updated_at="2026-11-02T08:00:00.000Z",
    )


async def test_not_logged_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.enterprise_publish_settings",
        lambda: None,
    )
    text = await _tool_enterprise_agent_builder(
        {"action": "list"},
        None,
        confirm_gate=_Gate(),
    )
    assert text == NOT_LOGGED_IN_TEXT


async def test_submit_requires_confirmation(monkeypatch: pytest.MonkeyPatch) -> None:
    _logged_in(monkeypatch)
    calls = {"n": 0}

    def _submit(**_kwargs: Any) -> dict:
        calls["n"] += 1
        return {
            "agent_id": "ag-1",
            "version": 1,
            "created": True,
            "lifecycle": "draft",
            "routing_mode": "follow_latest",
            "effective_version": 1,
        }

    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.submit_draft",
        _submit,
    )
    manifest = {"schema": "agx.agent/v1", "model": "openai/gpt-4o", "system": "整理销售表"}
    denied = _Gate(False)
    text = await _tool_enterprise_agent_builder(
        {"action": "submit", "display_name": "销售周报", "manifest": manifest},
        None,
        confirm_gate=denied,
    )
    assert "企业智能体草稿未提交" in text
    assert calls["n"] == 0

    allowed = _Gate(True)
    await _tool_enterprise_agent_builder(
        {"action": "submit", "display_name": "销售周报", "manifest": manifest},
        None,
        confirm_gate=allowed,
    )
    assert calls["n"] == 1
    assert allowed.questions
    assert "草稿版本" in allowed.questions[0]
    assert "新建智能体" in allowed.questions[0]


async def test_submit_existing_requires_ownership(monkeypatch: pytest.MonkeyPatch) -> None:
    _logged_in(monkeypatch)
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.list_my_agents",
        lambda **_kwargs: [_summary("someone-else")],
    )
    calls = {"n": 0}

    def _submit(**_kwargs: Any) -> dict:
        calls["n"] += 1
        raise AssertionError("submit_draft must not be called")

    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.submit_draft",
        _submit,
    )
    text = await _tool_enterprise_agent_builder(
        {
            "action": "submit",
            "agent_id": "missing",
            "manifest": {"schema": "agx.agent/v1", "model": "openai/gpt-4o"},
        },
        None,
        confirm_gate=_Gate(True),
    )
    assert text == "ERROR: 只能修改自己通过 Near 提交的企业智能体"
    assert calls["n"] == 0


async def test_submit_invalid_manifest_returns_preview(monkeypatch: pytest.MonkeyPatch) -> None:
    _logged_in(monkeypatch)
    calls = {"n": 0}

    def _submit(**_kwargs: Any) -> dict:
        calls["n"] += 1
        raise AssertionError("submit_draft must not be called")

    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.submit_draft",
        _submit,
    )
    gate = _Gate(True)
    text = await _tool_enterprise_agent_builder(
        {
            "action": "submit",
            "display_name": "销售周报",
            "manifest": {
                "schema": "agx.agent/v1",
                "model": "openai/gpt-4o",
                "tools": [{"type": "agx_builtin", "configs": [{"name": "knowledge_search"}]}],
            },
        },
        None,
        confirm_gate=gate,
    )
    assert text.startswith("## 预检结果：未通过")
    assert calls["n"] == 0
    assert gate.questions == []


async def test_submit_result_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    _logged_in(monkeypatch)
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.preview_manifest",
        lambda *_args, **_kwargs: PreviewReport(ok=True, summary=["新建智能体"], diff=""),
    )
    bodies = [
        {
            "agent_id": "ag-1",
            "version": 1,
            "created": True,
            "lifecycle": "draft",
            "routing_mode": "follow_latest",
            "effective_version": 1,
        },
        {
            "agent_id": "ag-1",
            "version": 3,
            "created": True,
            "lifecycle": "published",
            "routing_mode": "pinned",
            "effective_version": 2,
        },
        {
            "agent_id": "ag-1",
            "version": 2,
            "created": False,
            "lifecycle": "published",
            "routing_mode": "pinned",
            "effective_version": 2,
        },
        {
            "agent_id": "ag-1",
            "version": 4,
            "created": True,
            "lifecycle": "published",
            "routing_mode": "follow_latest",
            "effective_version": 4,
        },
    ]
    expected = [
        "已提交为草稿 v1（智能体 ag-1）。管理员在管理台「智能体」中发布后，才会对员工生效。",
        "已提交新版本 v3，当前生效仍是 v2。需管理员在管理台切换生效版本。",
        "内容与企业侧最新版本 v2 相同，未产生新版本。",
        "已提交 v4（published，路由 follow_latest，当前生效 v4）。",
    ]
    seen: dict[str, Any] = {}

    def _submit(**_kwargs: Any) -> dict:
        return seen["body"]

    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_builder.submit_draft",
        _submit,
    )
    manifest = {"schema": "agx.agent/v1", "model": "openai/gpt-4o"}
    for body, head in zip(bodies, expected):
        seen["body"] = body
        text = await _tool_enterprise_agent_builder(
            {"action": "submit", "display_name": "销售周报", "manifest": manifest},
            None,
            confirm_gate=_Gate(True),
        )
        assert text.startswith(head)
        assert "\n\n变更摘要：\n- 新建智能体" in text


def test_builtin_skill_discovered() -> None:
    loader = SkillBundleLoader(search_paths=[_SKILL_PACKAGE_SKILLS_DIR])
    found = [
        skill
        for skill in loader.scan()
        if skill.name == "agenticx-enterprise-agent-builder"
    ]
    assert len(found) == 1
    skill = found[0]
    assert infer_skill_source(skill.base_dir) == "builtin"
    assert skill.name == skill.base_dir.name
    text = skill.skill_md_path.read_text(encoding="utf-8")
    for name in MANAGED_BUILTIN_TOOLS:
        assert f"`{name}`" in text
    line = next(item for item in text.splitlines() if "14 个中选" in item)
    clause = line.split("。", 1)[0]
    listed = re.findall(r"`([^`]+)`", clause)
    assert set(listed) == set(MANAGED_BUILTIN_TOOLS)


def test_tool_is_deferred() -> None:
    assert is_deferred_builtin("enterprise_agent_builder") is True
    assert "enterprise_agent_builder" in BUILTIN_DEFER_ALLOWLIST
    names = [
        tool["function"]["name"]
        for tool in STUDIO_TOOLS
        if tool.get("function", {}).get("name") == "enterprise_agent_builder"
    ]
    assert len(names) == 1
    assert "enterprise_agent_builder" not in MANAGED_BUILTIN_TOOLS
