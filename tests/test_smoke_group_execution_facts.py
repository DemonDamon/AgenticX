#!/usr/bin/env python3
"""Smoke tests for deterministic group-chat execution facts.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.runtime.group_facts import (
    build_group_execution_facts,
    render_facts_block,
)


MEMBERS = [
    {"id": "wen", "name": "文策渊"},
    {"id": "cheng", "name": "程基岩"},
    {"id": "lin", "name": "林绘澄"},
    {"id": "you", "name": "游承峰"},
]


def _assistant(agent_id: str, text: str = "ok") -> dict:
    return {
        "role": "assistant",
        "content": text,
        "sender_id": agent_id,
        "agent_id": agent_id,
    }


def test_empty_history_marks_all_members_never_executed() -> None:
    facts = build_group_execution_facts(
        chat_history=[],
        members=MEMBERS,
        taskspaces=[],
        graph_status_by_agent={},
    )
    assert facts.has_any_execution is False
    assert set(facts.never_executed) == {"文策渊", "程基岩", "林绘澄", "游承峰"}


def test_incident_replay_meta_promises_do_not_count_as_execution() -> None:
    history = [
        _assistant("__meta__", "三线并行启动：文策渊/程基岩/林绘澄"),
        _assistant("__meta__", "三线都在推进"),
        _assistant("__meta__", "继续盯进度"),
        _assistant("you", "我先看一眼需求"),
    ]
    facts = build_group_execution_facts(
        chat_history=history,
        members=MEMBERS,
        taskspaces=[],
        graph_status_by_agent={},
    )
    assert facts.has_any_execution is False
    assert "文策渊" in facts.never_executed
    assert "程基岩" in facts.never_executed
    assert "林绘澄" in facts.never_executed
    assert "游承峰" not in facts.never_executed
    you = next(item for item in facts.members if item.agent_id == "you")
    assert you.reply_count == 1
    assert you.tool_calls == 0


def test_any_tool_row_counts_as_execution() -> None:
    history = [
        _assistant("__meta__", "开工"),
        {"role": "tool", "content": "ok", "agent_id": "cheng", "sender_id": "cheng"},
    ]
    facts = build_group_execution_facts(
        chat_history=history,
        members=MEMBERS,
        taskspaces=[],
        graph_status_by_agent={},
    )
    assert facts.has_any_execution is True
    assert facts.tool_call_total == 1


def test_render_facts_block_zero_exec_has_no_completion_percent() -> None:
    facts = build_group_execution_facts(
        chat_history=[],
        members=MEMBERS,
        taskspaces=[],
        graph_status_by_agent={},
    )
    text = render_facts_block(facts)
    assert "实际执行记录：无" in text
    assert "%" not in text
    assert "百分之" not in text


def test_memory_only_taskspace_is_not_an_artifact(tmp_path: Path) -> None:
    memory_dir = tmp_path / "memory"
    memory_dir.mkdir()
    (memory_dir / "2026-08-15.md").write_text("会话摘要", encoding="utf-8")
    facts = build_group_execution_facts(
        chat_history=[],
        members=MEMBERS,
        taskspaces=[{"id": "default", "path": str(tmp_path)}],
        graph_status_by_agent={},
    )
    assert facts.artifact_paths == []
    assert facts.has_any_execution is False
