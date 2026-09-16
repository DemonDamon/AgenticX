#!/usr/bin/env python3
"""Tests for evidence-preserving tool observation archive and recall.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from agenticx.runtime.tool_result_budget import (
    OBSERVATION_ID_RE,
    OBSERVATION_PREFIX,
    ToolResultBudgetConfig,
    apply_tool_result_budget,
    prepare_tool_result_observation,
    recall_tool_observation,
)


@dataclass
class MockSession:
    _session_id: Optional[str] = "sess-obs-001"
    session_id: Optional[str] = None
    _owner_session_id: Optional[str] = None
    _tool_result_meta: Dict[str, Any] = field(default_factory=dict)
    _tool_result_tokens_session: int = 0


def _cfg(**overrides: Any) -> ToolResultBudgetConfig:
    values: Dict[str, Any] = {
        "enabled": True,
        "keep_rounds": 2,
        "archive_batch_tokens": 0,
        "archive_subdir": "tool_archives",
    }
    values.update(overrides)
    return ToolResultBudgetConfig(**values)


def _compacted(raw: str, *, budget: int = 4000) -> str:
    if len(raw) <= budget:
        return raw
    head = max(200, budget // 3)
    tail = max(200, budget // 3)
    return (
        f"[micro-compact tool=bash_exec original_chars={len(raw)}]\n"
        f"{raw[:head]}\n"
        f"... truncated ({len(raw) - head - tail} chars omitted) ...\n"
        f"{raw[-tail:]}"
    )


def _prepare(
    session: Any,
    raw: str,
    *,
    tool_name: str = "bash_exec",
    compacted: Optional[str] = None,
    tool_call_id: str = "call_1",
    cfg: Optional[ToolResultBudgetConfig] = None,
):
    return prepare_tool_result_observation(
        session,
        round_idx=1,
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        raw_text=raw,
        compacted_text=compacted if compacted is not None else _compacted(raw),
        cfg=cfg or _cfg(),
    )


def _parse_recall_header(text: str) -> Dict[str, str]:
    first = text.splitlines()[0]
    return dict(re.findall(r"(\w+)=([^\s\]]+)", first))


def test_content_addressed_observation_is_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    raw = "HEAD\n" + ("X" * 8000) + "\nTAIL"
    first = _prepare(session, raw, tool_call_id="c1")
    second = _prepare(session, raw, tool_call_id="c2")

    assert first.observation_id is not None
    assert OBSERVATION_ID_RE.match(first.observation_id)
    assert first.observation_id == "obs_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert first.observation_id == second.observation_id
    assert first.archive_path is not None
    assert first.archive_path == second.archive_path
    assert first.archive_path.is_file()
    assert first.archive_path.read_bytes() == raw.encode("utf-8")
    assert first.archive_path.stat().st_mode & 0o777 == 0o600
    objects_root = tmp_path / ".agenticx" / "sessions" / "sess-obs-001" / "tool_archives" / "objects"
    assert objects_root.is_dir()
    files = list(objects_root.rglob("*.txt"))
    assert len(files) == 1
    assert OBSERVATION_PREFIX in first.projected_text
    assert f"id={first.observation_id}" in first.projected_text
    assert "tool_result_recall" in first.projected_text
    assert first.projected_text.endswith(_compacted(raw))
    assert first.projected_chars == len(first.projected_text)
    assert first.projected_chars <= len(_compacted(raw)) + 768


def test_observation_is_scoped_to_current_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    raw_a = "ALPHA-A\n" + ("Y" * 7000) + "\nOMEGA-A"
    raw_b = "ALPHA-B\n" + ("Z" * 7000) + "\nOMEGA-B"
    owner_a = MockSession(_session_id=None, session_id=None, _owner_session_id="avatar-a")
    owner_b = MockSession(_session_id=None, session_id=None, _owner_session_id="avatar-b")
    obs_a = _prepare(owner_a, raw_a, tool_call_id="a1")
    obs_b = _prepare(owner_b, raw_b, tool_call_id="b1")

    assert obs_a.observation_id != obs_b.observation_id
    assert obs_a.archive_path is not None
    assert obs_b.archive_path is not None
    assert "avatar-a" in str(obs_a.archive_path)
    assert "avatar-b" in str(obs_b.archive_path)

    recalled = recall_tool_observation(owner_a, observation_id=obs_a.observation_id or "")
    assert "ALPHA-A" in recalled
    with pytest.raises((ValueError, FileNotFoundError), match="unknown observation"):
        recall_tool_observation(owner_b, observation_id=obs_a.observation_id or "")
    with pytest.raises((ValueError, FileNotFoundError), match="unknown observation"):
        recall_tool_observation(owner_a, observation_id=obs_b.observation_id or "")


def test_recall_pages_round_trip_utf8_bytes_exactly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    raw = "前言\n" + ("中文行" * 80 + "é\n") * 40 + "结尾"
    raw_bytes = raw.encode("utf-8")
    obs = _prepare(session, raw)
    assert obs.observation_id is not None

    chunks: List[bytes] = []
    offset = 0
    for _ in range(64):
        page = recall_tool_observation(
            session,
            observation_id=obs.observation_id,
            offset_bytes=offset,
        )
        header = _parse_recall_header(page)
        assert header["id"] == obs.observation_id
        assert int(header["offset"]) == offset
        body = page.split("\n", 2)[2] if page.count("\n") >= 2 else ""
        chunks.append(body.encode("utf-8"))
        offset = int(header["next_offset"])
        if header["eof"] == "true":
            break
    assert b"".join(chunks) == raw_bytes


def test_recall_literal_search_returns_exact_context(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    lines = [f"line-{idx:03d}" for idx in range(40)]
    lines[20] = "MIDDLE_SENTINEL exact-hit"
    raw = "\n".join(lines) + ("\n" + ("Z" * 200)) * 30
    obs = _prepare(session, raw)
    assert obs.observation_id is not None
    assert "MIDDLE_SENTINEL" not in obs.projected_text.split("recall=", 1)[0][-200:]

    found = recall_tool_observation(
        session,
        observation_id=obs.observation_id,
        query="middle_sentinel",
        context_lines=2,
    )
    assert "matches=" in found
    assert "MIDDLE_SENTINEL exact-hit" in found
    assert "line-018" in found
    assert "line-019" in found
    assert "line-021" in found
    assert "line-022" in found


def test_recall_rejects_symlink_object(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    raw = "SAFE\n" + ("Q" * 6000)
    obs = _prepare(session, raw)
    assert obs.archive_path is not None
    real = obs.archive_path
    payload = real.read_bytes()
    decoy = tmp_path / "decoy.txt"
    decoy.write_bytes(payload)
    real.unlink()
    real.symlink_to(decoy)

    with pytest.raises((ValueError, FileNotFoundError, OSError)):
        recall_tool_observation(session, observation_id=obs.observation_id or "")
    try:
        recall_tool_observation(session, observation_id=obs.observation_id or "")
    except Exception as exc:
        assert str(real) not in str(exc)
        assert "unknown observation" in str(exc) or "symlink" in str(exc).lower()


def test_projection_falls_back_when_archive_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    raw = "FAILHEAD\n" + ("W" * 7000) + "\nFAILTAIL"
    compacted = _compacted(raw)
    blocker = tmp_path / ".agenticx" / "sessions" / "sess-obs-001" / "tool_archives"
    blocker.parent.mkdir(parents=True, exist_ok=True)
    blocker.write_text("not-a-dir", encoding="utf-8")

    obs = _prepare(session, raw, compacted=compacted)
    assert obs.observation_id is None
    assert obs.archive_path is None
    assert obs.projected_text == compacted
    assert OBSERVATION_PREFIX not in obs.projected_text


def test_observation_ages_by_following_assistant_messages_without_memory_meta(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    writer = MockSession()
    raw = "KEEP-ID\n" + ("M" * 7500)
    obs = _prepare(writer, raw)
    assert obs.observation_id is not None
    wrapper = obs.projected_text
    assert OBSERVATION_PREFIX in wrapper

    aged_session = MockSession(_tool_result_meta={})
    messages: List[Dict[str, Any]] = [
        {
            "role": "tool",
            "tool_call_id": "legacy",
            "name": "bash_exec",
            "content": wrapper,
        },
        {"role": "assistant", "content": "round-1"},
        {"role": "assistant", "content": "round-2"},
        {"role": "assistant", "content": "round-3"},
    ]
    out, stats = apply_tool_result_budget(
        messages,
        current_round=99,
        session=aged_session,
        cfg=_cfg(keep_rounds=2),
    )
    assert stats.archived_replaced == 1
    aged = [m for m in out if m.get("role") == "tool"][0]["content"]
    assert obs.observation_id in aged
    assert "tool_result_recall" in aged
    assert "KEEP-ID" not in aged or aged.count(obs.observation_id) >= 1
    assert str(obs.archive_path) not in aged
    assert "/.agenticx/sessions/" not in aged


def test_recall_rejects_unknown_and_illegal_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    _prepare(session, "OK\n" + ("N" * 6000))
    with pytest.raises((ValueError, FileNotFoundError), match="unknown observation"):
        recall_tool_observation(
            session,
            observation_id="obs_" + ("ab" * 32),
        )
    with pytest.raises(ValueError, match="invalid observation"):
        recall_tool_observation(session, observation_id="../etc/passwd")
    with pytest.raises(ValueError, match="invalid observation"):
        recall_tool_observation(session, observation_id="obs_nothex")


def test_recall_rejects_non_utf8_boundary_and_out_of_range(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    raw = "中" * 5000
    obs = _prepare(session, raw)
    assert obs.observation_id is not None
    with pytest.raises(ValueError, match="UTF-8"):
        recall_tool_observation(
            session,
            observation_id=obs.observation_id,
            offset_bytes=1,
        )
    with pytest.raises(ValueError, match="offset"):
        recall_tool_observation(
            session,
            observation_id=obs.observation_id,
            offset_bytes=len(raw.encode("utf-8")) + 50,
        )


def test_recall_is_not_observation_wrapped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    raw = "WRAPME\n" + ("P" * 6500)
    obs = _prepare(session, raw)
    page = recall_tool_observation(session, observation_id=obs.observation_id or "", offset_bytes=0)
    wrapped = prepare_tool_result_observation(
        session,
        round_idx=2,
        tool_call_id="recall_1",
        tool_name="tool_result_recall",
        raw_text=page,
        compacted_text=page,
        cfg=_cfg(),
    )
    assert wrapped.observation_id is None
    assert wrapped.projected_text == page
    assert not wrapped.projected_text.startswith(OBSERVATION_PREFIX)


def test_dispatch_recall_unknown_is_error_without_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.cli.agent_tools import _tool_result_recall

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    other = MockSession(_session_id="sess-other")
    raw = "DISPATCH\n" + ("D" * 7000)
    obs = _prepare(MockSession(_session_id="sess-owner"), raw)
    text = _tool_result_recall({"id": obs.observation_id}, other)
    assert text.startswith("ERROR:")
    assert "unknown observation" in text.lower()
    assert str(obs.archive_path) not in text


def test_recall_search_miss_is_not_unknown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    session = MockSession()
    obs = _prepare(session, "only-this\n" + ("V" * 6000))
    missed = recall_tool_observation(
        session,
        observation_id=obs.observation_id or "",
        query="NO_SUCH_TOKEN",
    )
    assert "matches=0" in missed
    assert "unknown observation" not in missed.lower()


def test_new_session_instance_recalls_same_session_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.cli.studio import StudioSession

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    raw = "RESTART-HIT\n" + ("R" * 7000) + "\nRESTART-TAIL"
    writer = StudioSession()
    writer._session_id = "sess-restart-001"
    obs = _prepare(writer, raw)
    assert obs.observation_id is not None
    del writer

    restarted = StudioSession()
    restarted._session_id = "sess-restart-001"
    found = recall_tool_observation(
        restarted,
        observation_id=obs.observation_id,
        query="RESTART-HIT",
        context_lines=0,
    )
    assert "RESTART-HIT" in found

    stranger = StudioSession()
    stranger._session_id = "sess-restart-other"
    with pytest.raises((ValueError, FileNotFoundError), match="unknown observation"):
        recall_tool_observation(stranger, observation_id=obs.observation_id)
