#!/usr/bin/env python3
"""Smoke tests for loop-halt progress signal fixes.

Covers:
- ``_tool_result_ok_flag`` JSON ``ok`` convention parsing.
- Successful meta-tool results (e.g. ``create_avatar`` with ``ok: true``)
  counting as progress so the no-progress loop detector does not fire.
- Repeated ``ok: false`` results still triggering the no-progress halt.
- ``_build_loop_halt_success_digest`` listing only confirmed successes.

Author: Damon Li
"""

from __future__ import annotations

import json
from types import SimpleNamespace

from agenticx.runtime.agent_runtime import (
    _build_loop_halt_success_digest,
    _tool_result_ok_flag,
)
from agenticx.runtime.loop_detector import LoopDetector


def test_ok_flag_true() -> None:
    result = json.dumps(
        {"ok": True, "avatar_id": "2027d8ea4ab4", "name": "程基岩"},
        ensure_ascii=False,
    )
    assert _tool_result_ok_flag(result) is True


def test_ok_flag_false() -> None:
    result = json.dumps(
        {"ok": False, "error": "avatar_exists", "message": "分身已存在"},
        ensure_ascii=False,
    )
    assert _tool_result_ok_flag(result) is False


def test_ok_flag_none_for_non_json_and_non_boolean() -> None:
    assert _tool_result_ok_flag("OK: wrote /tmp/a.txt") is None
    assert _tool_result_ok_flag("") is None
    assert _tool_result_ok_flag(None) is None
    assert _tool_result_ok_flag('{"ok": "yes"}') is None
    assert _tool_result_ok_flag('[{"ok": true}]') is None
    assert _tool_result_ok_flag('{"ok": true, "unterminated":') is None
    assert _tool_result_ok_flag('  {"ok": true}') is True


def test_create_avatar_success_prevents_false_loop_halt() -> None:
    det = LoopDetector()
    for idx in range(12):
        result = json.dumps(
            {"ok": True, "avatar_id": f"id{idx}", "name": f"分身{idx}"},
            ensure_ascii=False,
        )
        ok_flag = _tool_result_ok_flag(result)
        det.record_call(
            "create_avatar",
            LoopDetector.args_signature({"name": f"分身{idx}"}),
            has_progress=(ok_flag is True),
            result_text=result,
        )
    result = det.check()
    assert result is None or not (
        result.level == "critical" and result.detector == "no_progress"
    )


def test_repeated_avatar_exists_still_halts() -> None:
    det = LoopDetector()
    for _ in range(15):
        result = json.dumps(
            {"ok": False, "error": "avatar_exists", "message": "分身已存在"},
            ensure_ascii=False,
        )
        ok_flag = _tool_result_ok_flag(result)
        det.record_call(
            "create_avatar",
            LoopDetector.args_signature({"name": "严守真"}),
            has_progress=(ok_flag is True),
            result_text=result,
        )
    outcome = det.check()
    assert outcome is not None
    assert outcome.level == "critical"
    assert outcome.detector in {"no_progress", "generic_repeat", "tool_saturation"}


def _fake_session(messages: list[dict]) -> SimpleNamespace:
    return SimpleNamespace(agent_messages=messages)


def test_success_digest_lists_only_confirmed_successes() -> None:
    session = _fake_session(
        [
            {"role": "user", "content": "构建专家团"},
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": True, "avatar_id": "a1", "name": "程基岩"},
                    ensure_ascii=False,
                ),
            },
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": False, "error": "avatar_exists"},
                    ensure_ascii=False,
                ),
            },
            {"role": "tool", "name": "bash_exec", "content": "some plain output"},
            # duplicate of the first success — must be de-duplicated
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": True, "avatar_id": "a1", "name": "程基岩"},
                    ensure_ascii=False,
                ),
            },
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": True, "avatar_id": "a2", "name": "路远行"},
                    ensure_ascii=False,
                ),
            },
        ]
    )
    digest = _build_loop_halt_success_digest(session)
    assert "程基岩" in digest
    assert "路远行" in digest
    assert "avatar_exists" not in digest
    assert "bash_exec" not in digest
    assert digest.count("程基岩") == 1
    assert digest.startswith("- create_avatar 成功")


def test_success_digest_truncates_to_max_items() -> None:
    messages = [
        {
            "role": "tool",
            "name": "create_avatar",
            "content": json.dumps(
                {"ok": True, "avatar_id": f"id{i}", "name": f"分身{i}"},
                ensure_ascii=False,
            ),
        }
        for i in range(25)
    ]
    digest = _build_loop_halt_success_digest(_fake_session(messages))
    lines = [ln for ln in digest.splitlines() if ln.strip()]
    assert len(lines) == 20
    # keeps the most recent entries
    assert "分身24" in digest
    assert "分身0" not in digest


def test_success_digest_empty_session() -> None:
    assert _build_loop_halt_success_digest(_fake_session([])) == ""
    assert _build_loop_halt_success_digest(SimpleNamespace(agent_messages=None)) == ""
