#!/usr/bin/env python3
"""Smoke tests for agenticx.learning.loop_review (AC-4)."""

import asyncio
import json
from pathlib import Path

import agenticx.learning.session_review_hook as hook_mod
from agenticx.learning.loop_review import (
    format_review_text,
    review_session,
    write_review,
)
from agenticx.learning.session_review_hook import SessionReviewHook


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def test_empty_session_dir_does_not_raise(tmp_path: Path):
    review = review_session(tmp_path)
    assert review.overall <= 40
    assert len(review.dimensions) == 5
    weak = {"unobserved", "missing"}
    assert all(d.evidence in weak for d in review.dimensions)


def test_strong_session_scores_high_without_findings(tmp_path: Path):
    _write_json(
        tmp_path / "tool_call_observations.json",
        [
            {"tool_name": "file_write", "success": True},
            {"tool_name": "bash_exec", "result_summary": "pytest: 5 passed", "success": True},
            {"tool_name": "skill_manage", "success": True},
        ],
    )
    _write_json(
        tmp_path / "messages.json",
        [
            {"role": "user", "content": "帮我修复这个测试"},
            {"role": "assistant", "content": "..."},
            {"role": "user", "content": "很好，完成了"},
        ],
    )
    review = review_session(tmp_path)
    dims = {d.key: d for d in review.dimensions}
    assert dims["change_validation"].score >= 85
    assert review.overall >= 70
    assert review.findings == []


def test_unverified_writes_produce_change_validation_finding(tmp_path: Path):
    _write_json(
        tmp_path / "tool_call_observations.json",
        [{"tool_name": "file_write", "success": True}],
    )
    _write_json(
        tmp_path / "messages.json",
        [{"role": "user", "content": "改一下文件"}],
    )
    review = review_session(tmp_path)
    dims = {d.key: d for d in review.dimensions}
    assert dims["change_validation"].score <= 55
    assert dims["change_validation"].score < dims["change_validation"].raw_score
    finding = next((f for f in review.findings if f["key"] == "change_validation"), None)
    assert finding is not None
    assert finding["impact"]
    assert finding["repair"]
    assert finding["verification"]


def test_missing_observations_produce_no_findings(tmp_path: Path):
    # Only messages exist: we never saw a tool call, so we must not claim that
    # writes happened without verification.
    _write_json(
        tmp_path / "messages.json",
        [
            {"role": "user", "content": "帮我看看这个问题"},
            {"role": "assistant", "content": "..."},
            {"role": "user", "content": "好的"},
        ],
    )
    review = review_session(tmp_path)
    assert review.observations_available is False
    assert review.messages_available is True
    assert review.findings == []
    text = format_review_text(review)
    assert "无工具观察数据" in text


def test_write_review_persists_loadable_json(tmp_path: Path):
    review = review_session(tmp_path)
    path = write_review(review, tmp_path)
    assert path.name == "loop_review.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["schema_version"] == 1
    assert data["session_id"] == tmp_path.name
    assert len(data["dimensions"]) == 5


def test_format_review_text_marks_capped_dimensions(tmp_path: Path):
    _write_json(
        tmp_path / "tool_call_observations.json",
        [{"tool_name": "file_write", "success": True}],
    )
    review = review_session(tmp_path)
    text = format_review_text(review)
    assert "Overall" in text
    assert "已按证据封顶" in text


class _FakeSession:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.id = session_id


def _make_session_dir(home: Path, session_id: str) -> Path:
    d = home / ".agenticx" / "sessions" / session_id
    d.mkdir(parents=True, exist_ok=True)
    _write_json(d / "tool_call_observations.json", [{"tool_name": "file_read", "success": True}])
    return d


async def _drain_hook(hook: SessionReviewHook) -> None:
    # Wait until all fire-and-forget loop-review tasks settle.
    for _ in range(50):
        pending = [t for t in hook._loop_review_tasks if not t.done()]
        if not pending:
            return
        await asyncio.sleep(0.01)


def _run_async(coro) -> None:
    """Run a coroutine on a dedicated loop without closing the thread's
    implicit default loop (older tests rely on ``asyncio.get_event_loop``)."""
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(coro)
    finally:
        loop.close()


def test_on_agent_end_spawns_loop_review(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    sid = "ac7-basic"
    _make_session_dir(tmp_path, sid)
    hook = SessionReviewHook()
    monkeypatch.setattr(hook_mod, "_review_enabled", lambda: False)  # isolate loop review

    async def _run():
        await hook.on_agent_end("done", _FakeSession(sid))
        await _drain_hook(hook)

    _run_async(_run())
    assert (tmp_path / ".agenticx" / "sessions" / sid / "loop_review.json").is_file()


def test_loop_review_disabled_skips_write(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    sid = "ac7-disabled"
    _make_session_dir(tmp_path, sid)
    monkeypatch.setattr(hook_mod, "_review_enabled", lambda: False)
    monkeypatch.setattr(
        hook_mod, "get_learning_config", lambda: {"loop_review_enabled": False}
    )
    hook = SessionReviewHook()

    async def _run():
        await hook.on_agent_end("done", _FakeSession(sid))
        await _drain_hook(hook)

    _run_async(_run())
    assert not (tmp_path / ".agenticx" / "sessions" / sid / "loop_review.json").exists()


def test_loop_review_never_raises_on_failure(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    sid = "ac7-fail"
    _make_session_dir(tmp_path, sid)
    monkeypatch.setattr(hook_mod, "_review_enabled", lambda: False)

    def _boom(_dir):
        raise RuntimeError("boom")

    monkeypatch.setattr(hook_mod, "review_session", _boom)
    hook = SessionReviewHook()

    async def _run():
        await hook.on_agent_end("done", _FakeSession(sid))
        await _drain_hook(hook)

    # Must not propagate.
    _run_async(_run())
