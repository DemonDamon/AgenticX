#!/usr/bin/env python3
"""Tests for AGX Studio command state helpers.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Generator, List, Union

from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMChoice, LLMResponse, TokenUsage

from agenticx.cli.studio import (
    HistoryRecord,
    StudioSession,
    _handle_image_command,
    _resolve_at_references,
    _restore_last_snapshot,
    _take_snapshot,
)


class _FakeProvider(BaseLLMProvider):
    model: str = "fake-model"

    def invoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        content = "这是一条聊天回复。"
        return LLMResponse(
            id="fake-1",
            model_name=self.model,
            created=0,
            content=content,
            choices=[LLMChoice(index=0, content=content, finish_reason="stop")],
            token_usage=TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
        )

    async def ainvoke(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> LLMResponse:
        return self.invoke(prompt, **kwargs)

    def stream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> Generator[Union[str, Dict], None, None]:
        yield "fake"

    async def astream(self, prompt: Union[str, List[Dict]], **kwargs: Any) -> AsyncGenerator[Union[str, Dict], None]:
        yield "fake"


def test_restore_last_snapshot_rolls_back_artifacts_and_history() -> None:
    session = StudioSession()
    first_path = Path("first.py")
    second_path = Path("second.py")

    session.artifacts[first_path] = "print('v1')"
    session.history.append(
        HistoryRecord(description="first", file_path=first_path, target="agent")
    )
    session.image_b64.append({"data": "abc", "mime": "image/png"})

    _take_snapshot(session)

    session.artifacts[second_path] = "print('v2')"
    session.history.append(
        HistoryRecord(description="second", file_path=second_path, target="agent")
    )
    session.image_b64.append({"data": "def", "mime": "image/png"})

    assert _restore_last_snapshot(session) is True
    assert list(session.artifacts.keys()) == [first_path]
    assert [record.file_path for record in session.history] == [first_path]
    assert session.image_b64 == [{"data": "abc", "mime": "image/png"}]


def test_image_clear_empties_sticky_image_context() -> None:
    session = StudioSession()
    session.image_b64.extend(
        [
            {"data": "abc", "mime": "image/png"},
            {"data": "def", "mime": "image/jpeg"},
        ]
    )

    _handle_image_command(session, "/image clear")

    assert session.image_b64 == []


def test_run_studio_chat_input_does_not_call_codegen(monkeypatch) -> None:
    from agenticx.cli import studio as studio_module

    inputs = iter(["你是？", "/exit"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    monkeypatch.setattr(studio_module.ProviderResolver, "resolve", lambda **_: _FakeProvider(model="fake-model"))

    studio_module.run_studio()


def test_run_studio_question_input_does_not_call_codegen(monkeypatch) -> None:
    from agenticx.cli import studio as studio_module

    inputs = iter(["如何创建一个Agent？", "/exit"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    monkeypatch.setattr(studio_module.ProviderResolver, "resolve", lambda **_: _FakeProvider(model="fake-model"))

    studio_module.run_studio()


def test_run_studio_generate_input_routes_to_agent_loop(monkeypatch) -> None:
    from agenticx.cli import studio as studio_module
    from agenticx.cli import agent_loop as agent_loop_module

    inputs = iter(["帮我创建一个Agent", "/exit"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    monkeypatch.setattr(studio_module, "_print_header", lambda _session: None)
    monkeypatch.setattr(studio_module.ProviderResolver, "resolve", lambda **_: object())
    called = {"count": 0}

    def _fake_run_agent_loop(_session, _llm, _user_input):
        called["count"] += 1
        return "ok"

    monkeypatch.setattr(agent_loop_module, "run_agent_loop", _fake_run_agent_loop)

    studio_module.run_studio()
    assert called["count"] == 1


def test_run_studio_takes_snapshot_before_agent_loop_for_undo(monkeypatch) -> None:
    from agenticx.cli import studio as studio_module
    from agenticx.cli import agent_loop as agent_loop_module

    inputs = iter(["普通输入", "/undo", "/exit"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    monkeypatch.setattr(studio_module, "_print_header", lambda _session: None)
    monkeypatch.setattr(studio_module.ProviderResolver, "resolve", lambda **_: object())
    seen = {"snapshot_before_loop": False}
    captured_session = {"value": None}

    def _fake_run_agent_loop(session, _llm, _user_input):
        captured_session["value"] = session
        seen["snapshot_before_loop"] = len(session.snapshots) == 1
        session.context_files["temp.txt"] = "temp-content"
        return "loop-ok"

    monkeypatch.setattr(agent_loop_module, "run_agent_loop", _fake_run_agent_loop)
    studio_module.run_studio()

    assert seen["snapshot_before_loop"] is True
    assert captured_session["value"] is not None
    assert captured_session["value"].context_files == {}


def test_resolve_at_references_rejects_path_outside_workspace(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "secret.txt"
    outside.write_text("top-secret", encoding="utf-8")
    monkeypatch.chdir(workspace)

    session = StudioSession()
    _resolve_at_references(session, f"请查看 @{outside}")

    assert session.context_files == {}
