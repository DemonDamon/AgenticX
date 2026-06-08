#!/usr/bin/env python3
"""Smoke tests for Near stuck-prevention plan (2026-06-08).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agenticx.runtime.loop_detector import LoopDetector
from agenticx.runtime.scratchpad_utils import normalize_scratchpad_loaded, scratchpad_truthy
from agenticx.runtime.todo_disk_reconcile import (
    collect_disk_write_paths,
    in_progress_item_has_disk_evidence,
    todos_need_disk_promote,
)
from agenticx.skills.guard import ScanResult, format_guard_rejection_message
from agenticx.skills.guard_types import ScanFinding
from agenticx.studio.continuation import interrupt_running_for_continue
from agenticx.studio.supervisor import _session_unattended_enabled


def test_scratchpad_truthy_accepts_string_one() -> None:
    assert scratchpad_truthy(True) is True
    assert scratchpad_truthy("1") is True
    assert scratchpad_truthy("true") is True
    assert scratchpad_truthy("0") is False
    assert scratchpad_truthy("false") is False


def test_normalize_scratchpad_loaded_bool_keys() -> None:
    data = normalize_scratchpad_loaded({"unattended_enabled": "1"})
    assert data["unattended_enabled"] is True


def test_session_unattended_enabled_with_string_one() -> None:
    session = SimpleNamespace(scratchpad={"unattended_enabled": "1"})
    managed = SimpleNamespace(studio_session=session, session_id="s1")
    assert _session_unattended_enabled(managed) is True


def test_loop_detector_guard_rejection_loop() -> None:
    det = LoopDetector(warning_threshold=3, critical_threshold=5)
    for _ in range(3):
        det.record_call(
            "skill_manage",
            "{}",
            has_progress=False,
            result_text="ERROR: guard rejected write (dangerous)",
        )
    issue = det.check()
    assert issue is not None
    assert issue.detector == "guard_rejection"
    assert issue.level == "critical"


def test_format_guard_rejection_message_structured() -> None:
    result = ScanResult(
        verdict="dangerous",
        findings=[
            ScanFinding(
                severity="dangerous",
                pattern_name="curl_exfil",
                matched_text="curl ${TOKEN}",
                file_path="SKILL.md",
                line_number=3,
                category="exfiltration",
            )
        ],
        source="agent-created",
    )
    msg = format_guard_rejection_message(result)
    assert "安全策略拦截" in msg
    assert "exfiltration" in msg or "数据外泄" in msg
    assert "skill_manage patch" in msg


def test_todos_need_disk_promote_with_skill_md_write() -> None:
    messages = [
        {
            "role": "tool",
            "tool_name": "todo_write",
            "content": "(5/7 completed)\n- [x] step\n- [>] 更新 SKILL.md\n- [ ] tail",
        },
        {
            "role": "tool",
            "tool_name": "file_write",
            "content": "OK: wrote /Users/me/.agenticx/skills/foo/SKILL.md",
        },
    ]
    assert collect_disk_write_paths(messages)
    assert in_progress_item_has_disk_evidence(
        "更新 SKILL.md",
        collect_disk_write_paths(messages),
    )
    assert todos_need_disk_promote(messages) is True


@pytest.mark.asyncio
async def test_interrupt_running_for_continue_sets_interrupted() -> None:
    managed = SimpleNamespace(execution_state="running")
    manager = MagicMock()
    manager.get.return_value = managed
    manager.request_interrupt = MagicMock()
    manager.set_execution_state = MagicMock()
    manager.persist_async = AsyncMock()

    state = await interrupt_running_for_continue(manager, "sid-1")
    assert state == "interrupted"
    manager.request_interrupt.assert_called_once_with("sid-1")
    manager.set_execution_state.assert_called_once_with("sid-1", "interrupted")
    manager.persist_async.assert_awaited_once_with("sid-1")
