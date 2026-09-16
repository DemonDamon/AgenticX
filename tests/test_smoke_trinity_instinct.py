#!/usr/bin/env python3
"""Smoke tests for trinity instinct learning components.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.learning.instinct import Instinct
from agenticx.learning.instinct_store import InstinctStore
from agenticx.learning.observer import ObservationHook


def test_instinct_roundtrip_markdown() -> None:
    instinct = Instinct(
        id="prefer-smoke-tests",
        trigger="when adding new behavior",
        action="add smoke test first",
        confidence=0.7,
        domain="testing",
        scope="project",
        project_id="abc12345",
        evidence=["added three smoke tests"],
    )
    parsed = Instinct.from_markdown(instinct.to_markdown())
    assert parsed.id == instinct.id
    assert parsed.trigger == instinct.trigger
    assert parsed.scope == "project"
    assert parsed.evidence == instinct.evidence


def test_instinct_store_persists_and_loads(tmp_path: Path) -> None:
    store = InstinctStore(root_dir=tmp_path / "instincts")
    instinct = Instinct(
        id="keep-diffs-small",
        trigger="when patching core runtime",
        action="split into isolated commits",
        confidence=0.6,
        domain="workflow",
        scope="global",
        project_id=None,
    )
    path = store.save(instinct)
    assert path.exists()
    loaded = store.list_instincts(scope="global")
    assert len(loaded) == 1
    assert loaded[0].id == "keep-diffs-small"


def test_observation_hook_persists_to_the_session_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """观察记录落在 ``~/.agenticx/sessions/<session_id>/tool_call_observations.json``。

    这条用例原来按 ``instincts/projects/<project_id>/observations.jsonl`` 断言，并且
    调 ``hook._project_id(session)``。落点后来改成了按 session_id 组织
    （见 observer._resolve_session_dir），``_project_id`` 也随之删掉，于是这里一直是
    AttributeError。tests/test_smoke_hermes_agent_observer.py 断言的才是现在的契约。
    """
    monkeypatch.setenv("AGX_LEARNING_ENABLED", "true")
    monkeypatch.setattr("agenticx.learning.observer.Path.home", lambda: tmp_path)
    session = StudioSession()
    session.workspace_dir = str(tmp_path / "workspace")
    session.session_id = "sess-1"
    hook = ObservationHook()

    async def _run() -> None:
        await hook.after_tool_call("file_read", "ok-result", session)
        # _persist 是 create_task 起的后台写，等它落盘。
        await asyncio.sleep(0.15)

    asyncio.run(_run())

    output_file = (
        tmp_path / ".agenticx" / "sessions" / "sess-1" / "tool_call_observations.json"
    )
    assert output_file.exists(), f"observations not found at {output_file}"
    observations = json.loads(output_file.read_text(encoding="utf-8"))
    assert [o["tool_name"] for o in observations] == ["file_read"]
    assert observations[0]["success"] is True
