#!/usr/bin/env python3
"""Tests for the in-process reliability fault-injection bench.

Author: Damon Li
"""

from __future__ import annotations

import socket
from pathlib import Path

import pytest

from agenticx.evaluation.evalset import EvalSet
from agenticx.evaluation.fault_injection import (
    CountingTool,
    FaultInjector,
    FaultKind,
    FaultSpec,
    SideEffectCounter,
    _InjectedCrash,
)
from agenticx.evaluation.reliability_runner import (
    ReliabilityCase,
    ReliabilityRunner,
    _is_diagnosable,
    check_history_consistency,
)

BENCHMARK = (
    Path(__file__).resolve().parents[1]
    / "agenticx"
    / "evaluation"
    / "benchmarks"
    / "reliability_v1.json"
)


def test_injector_fires_once() -> None:
    injector = FaultInjector(FaultSpec(FaultKind.KILL_BEFORE_TOOL_RESULT))
    hits = [
        injector.should_fire(
            boundary="before_tool_result", call_index=1, tool_name="bump"
        )
        for _ in range(5)
    ]
    assert hits == [True, False, False, False, False]
    assert injector.fired is True


def test_injector_respects_call_index() -> None:
    injector = FaultInjector(
        FaultSpec(FaultKind.KILL_BEFORE_TOOL_RESULT, at_call_index=2)
    )
    assert injector.should_fire(
        boundary="before_tool_result", call_index=1, tool_name="bump"
    ) is False
    assert injector.should_fire(
        boundary="before_tool_result", call_index=2, tool_name="bump"
    ) is True


def test_injector_respects_tool_name() -> None:
    injector = FaultInjector(
        FaultSpec(FaultKind.KILL_BEFORE_TOOL_RESULT, tool_name="bump")
    )
    assert injector.should_fire(
        boundary="before_tool_result", call_index=1, tool_name="other"
    ) is False
    assert injector.should_fire(
        boundary="before_tool_result", call_index=1, tool_name="bump"
    ) is True


def test_injected_crash_not_caught_by_except_exception() -> None:
    try:
        raise _InjectedCrash("boom")
    except Exception:  # noqa: BLE001
        pytest.fail("InjectedCrash must not be caught by except Exception")
    except _InjectedCrash:
        pass


def test_counter_duplicate_count() -> None:
    counter = SideEffectCounter()
    counter.apply("a", {"n": 1})
    counter.apply("a", {"n": 2})
    counter.apply("a", {"n": 3})
    assert counter.duplicate_count == 2
    other = SideEffectCounter()
    other.apply("a", {})
    other.apply("b", {})
    assert other.duplicate_count == 0


def test_counter_read_not_counted() -> None:
    counter = SideEffectCounter()
    tool = CountingTool(counter, effect_class="read")
    tool._run(key="a")
    tool._run(key="a")
    tool._run(key="a")
    assert counter.duplicate_count == 0
    assert len(counter.reads) == 3


def test_reliability_case_roundtrip() -> None:
    original = ReliabilityCase(
        id="roundtrip",
        query="go",
        fault=FaultSpec(FaultKind.PERSIST_FAILURE, at_call_index=1, tool_name=None),
        llm_script=[[{"final": "ok"}]],
        tool_effect_class="read",
        expected_total_effects=1,
        expect_resume_success=False,
        expect_error_diagnosable=True,
    )
    assert ReliabilityCase.from_eval_case(original.to_eval_case()) == original


def test_benchmark_json_is_valid_evalset() -> None:
    evalset = EvalSet.from_file(BENCHMARK)
    assert evalset.name == "agenticx-reliability-v1"
    assert len(evalset) >= 12


def test_is_diagnosable_rejects_bare_token() -> None:
    assert _is_diagnosable("'_type'", tool_name="bump") is False
    assert _is_diagnosable("KeyError", tool_name="bump") is False


def test_is_diagnosable_accepts_full_reason() -> None:
    assert (
        _is_diagnosable(
            "bump 会产生外部副作用且执行结果未知，已跳过重跑",
            tool_name="bump",
        )
        is True
    )


def test_history_check_detects_orphan_tool_row() -> None:
    messages = [
        {"role": "user", "content": "hi"},
        {"role": "tool", "tool_call_id": "c1", "content": "orphan"},
    ]
    assert check_history_consistency(messages) is False


def test_history_check_detects_duplicate_tool_row() -> None:
    messages = [
        {
            "role": "assistant",
            "tool_calls": [{"id": "c1", "function": {"name": "bump"}}],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "a"},
        {"role": "tool", "tool_call_id": "c1", "content": "b"},
    ]
    assert check_history_consistency(messages) is False


def test_history_check_accepts_valid() -> None:
    messages = [
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "tool_calls": [{"id": "c1", "function": {"name": "bump"}}],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "ok"},
        {"role": "assistant", "content": "done"},
    ]
    assert check_history_consistency(messages) is True


def _run_bench(tmp_path: Path):
    evalset = EvalSet.from_file(BENCHMARK)
    return ReliabilityRunner(root=tmp_path).run(evalset)


def test_bench_runs_offline(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class _BlockedSocket(socket.socket):
        def connect(self, address):  # type: ignore[override]
            raise RuntimeError("network disabled")

        def connect_ex(self, address):  # type: ignore[override]
            raise RuntimeError("network disabled")

    monkeypatch.setattr("socket.socket", _BlockedSocket)
    metrics = _run_bench(tmp_path)
    assert metrics.total_cases >= 12


def test_zero_duplicate_side_effects(tmp_path: Path) -> None:
    assert _run_bench(tmp_path).duplicate_side_effect_rate == 0.0


def test_full_crash_recovery(tmp_path: Path) -> None:
    assert _run_bench(tmp_path).crash_recovery_success_rate == 1.0


def test_full_history_consistency(tmp_path: Path) -> None:
    assert _run_bench(tmp_path).history_consistency_rate == 1.0


def test_full_error_diagnosability(tmp_path: Path) -> None:
    assert _run_bench(tmp_path).error_diagnosability_rate == 1.0


def test_metrics_report_contains_methodology(tmp_path: Path) -> None:
    report = _run_bench(tmp_path).to_report()
    assert "进程内模拟崩溃" in report


def test_bench_is_deterministic(tmp_path: Path) -> None:
    first = _run_bench(tmp_path / "a")
    second = _run_bench(tmp_path / "b")
    assert first.duplicate_side_effect_rate == second.duplicate_side_effect_rate
    assert first.crash_recovery_success_rate == second.crash_recovery_success_rate
    assert first.history_consistency_rate == second.history_consistency_rate
    assert first.error_diagnosability_rate == second.error_diagnosability_rate
    keys = (
        "id",
        "duplicates",
        "resume_ok",
        "history_ok",
        "diagnosable",
        "effects_total",
    )
    assert [{k: row[k] for k in keys} for row in first.per_case] == [
        {k: row[k] for k in keys} for row in second.per_case
    ]


def test_bench_uses_tmp_path(tmp_path: Path) -> None:
    home = Path.home() / ".agenticx"

    def _files() -> set[str]:
        if not home.exists():
            return set()
        return {str(path.relative_to(home)) for path in home.rglob("*") if path.is_file()}

    before = _files()
    _run_bench(tmp_path)
    assert _files() == before
