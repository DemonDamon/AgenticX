#!/usr/bin/env python3
"""Smoke tests: group-chat LLM completion budget and empty-reply fallback.

Author: Damon Li
"""

from __future__ import annotations

import logging
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import (
    GroupChatRouter,
    _META_EMPTY_REPLY_NOTICE,
)
from agenticx.runtime.harden_flags import (
    group_intent_max_tokens,
    group_meta_reply_max_tokens,
)

_REPO_ROOT = Path(__file__).resolve().parents[1]
_GROUP_ROUTER_PATH = _REPO_ROOT / "agenticx" / "runtime" / "group_router.py"


def _make_avatar(name: str, role: str = "专家") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = role
    return avatar


def _make_router(*, llm: object | None = None) -> GroupChatRouter:
    avatars = {
        "wen": _make_avatar("文策渊"),
        "cheng": _make_avatar("程基岩"),
        "lin": _make_avatar("林绘澄"),
        "you": _make_avatar("游承峰"),
    }
    registry = MagicMock()
    registry.get_avatar = MagicMock(side_effect=lambda aid: avatars.get(str(aid)))
    factory = MagicMock(return_value=llm if llm is not None else MagicMock())
    return GroupChatRouter(
        avatar_registry=registry,
        llm_factory=factory,
        max_tool_rounds=5,
    )


def _make_session() -> MagicMock:
    sess = MagicMock()
    sess.session_id = "budget-session"
    sess._session_id = "budget-session"
    sess.provider_name = "minimax"
    sess.model_name = "MiniMax-M2.7"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    sess.chat_history = []
    sess.__group_avatar_ids = ["wen", "cheng", "lin", "you"]
    return sess


def _isolate_token_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_GROUP_INTENT_MAX_TOKENS", raising=False)
    monkeypatch.delenv("AGX_GROUP_META_REPLY_MAX_TOKENS", raising=False)
    monkeypatch.setattr(
        "agenticx.runtime.harden_flags._config_int",
        lambda key: None,
    )


class _FakeChoice:
    def __init__(self, finish_reason: str) -> None:
        self.finish_reason = finish_reason


class _FakeResponse:
    def __init__(self, content: str, finish_reason: str) -> None:
        self.content = content
        self.choices = [_FakeChoice(finish_reason)]


class _ScriptedLLM:
    def __init__(self, responses: list[_FakeResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    def invoke(self, messages, **kwargs):
        self.calls.append(dict(kwargs))
        return self._responses.pop(0)


def test_group_token_flags_defaults_and_clamp(monkeypatch: pytest.MonkeyPatch) -> None:
    _isolate_token_flags(monkeypatch)
    assert group_intent_max_tokens() == 1500
    assert group_meta_reply_max_tokens() == 2000

    monkeypatch.setenv("AGX_GROUP_INTENT_MAX_TOKENS", "99")
    assert group_intent_max_tokens() == 280

    monkeypatch.setenv("AGX_GROUP_INTENT_MAX_TOKENS", "999999")
    assert group_intent_max_tokens() == 8000

    monkeypatch.setenv("AGX_GROUP_INTENT_MAX_TOKENS", "abc")
    assert group_intent_max_tokens() == 1500


@pytest.mark.asyncio
async def test_analyze_intent_and_pm_reply_pass_raised_budgets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate_token_flags(monkeypatch)
    router = _make_router()
    captured: list[int] = []

    async def stub_llm(**kwargs):
        captured.append(int(kwargs.get("max_tokens") or 0))
        return '{"action":"route_to","target_ids":["cheng"],"reason":"ok"}'

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session()
    context = GroupChatContext(session)
    await router._analyze_intent(
        base_session=session,
        context=context,
        group_name="游戏开发工作室",
        group_avatar_ids=["wen", "cheng", "lin", "you"],
        user_input="就开始做呀，我现在就要看到能玩的东西",
        explicit_targets=[],
    )
    await router._run_meta_project_manager_reply(
        base_session=session,
        context=context,
        group_name="游戏开发工作室",
        user_input="就开始做呀，我现在就要看到能玩的东西",
    )
    assert captured == [1500, 2000]


@pytest.mark.asyncio
async def test_call_llm_text_retries_on_length_empty() -> None:
    llm = _ScriptedLLM(
        [
            _FakeResponse("\n\n", "length"),
            _FakeResponse("正常回复", "stop"),
        ]
    )
    router = _make_router(llm=llm)
    text = await router._call_llm_text(
        provider=None,
        model=None,
        prompt="x",
        max_tokens=500,
    )
    assert text == "正常回复"
    assert len(llm.calls) == 2
    assert llm.calls[1]["max_tokens"] == 1000


@pytest.mark.asyncio
async def test_call_llm_text_does_not_retry_on_stop_empty() -> None:
    llm = _ScriptedLLM([_FakeResponse("", "stop")])
    router = _make_router(llm=llm)
    text = await router._call_llm_text(
        provider=None,
        model=None,
        prompt="x",
        max_tokens=500,
    )
    assert text == ""
    assert len(llm.calls) == 1


@pytest.mark.asyncio
async def test_intent_parse_failed_is_observable(caplog: pytest.LogCaptureFixture) -> None:
    router = _make_router()

    async def stub_llm(**kwargs):
        return "\n\n"

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session()
    context = GroupChatContext(session)
    with caplog.at_level(logging.WARNING, logger="agenticx.runtime.group_router"):
        decision = await router._analyze_intent(
            base_session=session,
            context=context,
            group_name="游戏开发工作室",
            group_avatar_ids=["wen", "cheng", "lin", "you"],
            user_input="就开始做呀",
            explicit_targets=[],
        )
    assert decision.action == "meta_direct"
    assert decision.reason == "intent_parse_failed"
    assert "intent JSON unparsable" in caplog.text


def test_empty_reply_notice_is_not_a_progress_report() -> None:
    assert "当前可确认的进展" not in _META_EMPTY_REPLY_NOTICE
    assert "没有产出内容" in _META_EMPTY_REPLY_NOTICE
    source = _GROUP_ROUTER_PATH.read_text(encoding="utf-8")
    assert "暂无足够信息，请指明想看的模块或成员" not in source
