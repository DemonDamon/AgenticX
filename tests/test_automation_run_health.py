#!/usr/bin/env python3
"""Shared-fixture tests for automation run health transitions.

Author: Damon Li
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from agenticx.runtime.automation_run_health import (
    INTERRUPTED_TEXT,
    NEEDS_USER_ACTION_MARKERS,
    apply_run_outcome,
    apply_user_enable_toggle,
    mark_interrupted_on_startup,
    mark_run_started,
)

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "automation_run_health_cases.json"


def _load_cases() -> list[dict[str, Any]]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _step(task: dict[str, Any], action: str, args: dict[str, Any]) -> dict[str, Any]:
    if action == "start":
        return mark_run_started(task, str(args["nowIso"]))
    if action == "outcome":
        return apply_run_outcome(
            task,
            ok=bool(args["ok"]),
            error=str(args["error"]) if isinstance(args.get("error"), str) else "",
            trigger="manual" if args.get("trigger") == "manual" else "schedule",
            now_iso=str(args["nowIso"]),
        )
    if action == "startup":
        running_ids = {str(item) for item in args.get("runningIds") or []}
        return mark_interrupted_on_startup(task, running_ids)
    return apply_user_enable_toggle(task, copy.deepcopy(args["next"]))


def _apply(case: dict[str, Any]) -> dict[str, Any]:
    repeat = int(case["args"].get("repeat") or 1)
    current = copy.deepcopy(case["before"])
    for _ in range(repeat):
        current = _step(current, case["action"], case["args"])
    return current


def test_automation_needs_user_action_markers_match_plan_table() -> None:
    assert list(NEEDS_USER_ACTION_MARKERS) == [
        {"needle": "无人值守运行不批准受保护操作", "label": "任务里有需要批准的操作"},
        {"needle": "企业登录已失效", "label": "企业账号登录已失效"},
        {"needle": "invalid_api_key", "label": "模型 API Key 无效"},
        {"needle": "incorrect api key", "label": "模型 API Key 无效"},
        {"needle": "http 401", "label": "鉴权失败"},
        {"needle": "http 403", "label": "没有权限"},
    ]
    needles = [item["needle"] for item in NEEDS_USER_ACTION_MARKERS]
    # A missed approval timeout is intentionally not an immediate pause.
    assert "无人值守等待审批超时" not in needles


def test_automation_helpers_do_not_mutate_input() -> None:
    task = {"id": "x", "enabled": True, "lastRunError": "x"}
    snapshot = copy.deepcopy(task)
    mark_run_started(task, "2026-10-12T00:00:00.000Z")
    apply_run_outcome(
        task,
        ok=False,
        error="e",
        trigger="schedule",
        now_iso="2026-10-12T00:00:00.000Z",
    )
    mark_interrupted_on_startup({**task, "runningSince": "t"}, set())
    apply_user_enable_toggle(task, {"enabled": True})
    assert task == snapshot


def test_automation_interrupted_text_constant() -> None:
    interrupted = next(case for case in _load_cases() if str(case["name"]).startswith("AC-7"))
    assert interrupted["expect"]["lastRunError"] == INTERRUPTED_TEXT


@pytest.mark.parametrize("case", _load_cases(), ids=lambda case: case["name"])
def test_automation_run_health_case(case: dict[str, Any]) -> None:
    assert _apply(case) == case["expect"]
