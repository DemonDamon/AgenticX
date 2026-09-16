#!/usr/bin/env python3
"""Fault-injection runner that drives ReActAgent (sibling of EvalRunner).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agenticx.agents.agent_events import ErrorEvent, FinalEvent
from agenticx.agents.react_agent_async import ReActAgent
from agenticx.evaluation.evalset import EvalCase, EvalSet
from agenticx.evaluation.fault_injection import (
    CountingTool,
    FaultInjector,
    FaultKind,
    FaultSpec,
    ScriptedFakeLLM,
    SideEffectCounter,
    _InjectedCrash,
)
from agenticx.reliability.call_ledger import CallLedger
from agenticx.reliability.errors import ToolCallIdentityError
from agenticx.reliability.run_state import RunStateStore
from agenticx.runtime.interrupted_closers import KIND_OUTCOME_UNKNOWN

_BARE_TOKENS = frozenset(
    {"_type", "KeyError", "OSError", "ValueError", "Exception", "TypeError"}
)
_REASON_MARKERS = (
    "持久化失败",
    "参数不一致",
    "changed fields",
    "different arguments",
    "external_side_effect",
    "unknown_side_effect",
    "local_write_ambiguous",
    "identity_conflict",
    "已跳过重跑",
    "无法安全恢复",
    "timeout",
)


def _is_diagnosable(text: str, *, tool_name: str) -> bool:
    body = (text or "").strip()
    if not body:
        return False
    collapsed = body.strip("'\"")
    if collapsed in _BARE_TOKENS:
        return False
    if tool_name not in body:
        return False
    return any(marker in body for marker in _REASON_MARKERS)


def check_history_consistency(messages: list[dict[str, Any]]) -> bool:
    """Provider-safe tool_call pairing: one tool row per id, in order."""
    declared: set[str] = set()
    for index, msg in enumerate(messages):
        role = msg.get("role")
        if role == "assistant" and index + 1 < len(messages):
            nxt = messages[index + 1]
            if nxt.get("role") == "assistant" and msg.get("tool_calls"):
                return False
        if role == "tool":
            tid = msg.get("tool_call_id")
            if tid is None or tid == "":
                return False
            if tid not in declared:
                return False
        if role == "assistant" and msg.get("tool_calls"):
            ids = [str(tc.get("id") or "") for tc in msg["tool_calls"]]
            following: list[str] = []
            for later in messages[index + 1 :]:
                if later.get("role") == "assistant":
                    break
                if later.get("role") == "tool":
                    following.append(later.get("tool_call_id"))
            needed: list[str] = []
            seen: set[str] = set()
            for tid in ids:
                if not tid:
                    return False
                declared.add(tid)
                if tid not in seen:
                    needed.append(tid)
                    seen.add(tid)
            from collections import Counter

            counts = Counter(following)
            if any(counts.get(tid, 0) != 1 for tid in needed):
                return False
            extra = set(following) - set(needed)
            if extra:
                return False
            if following != needed:
                return False
    return True


@dataclass(frozen=True)
class ReliabilityCase:
    """One fault-injection scenario.

    Serialises into a standard ``EvalCase`` whose ``metadata`` carries the
    fault spec, so a reliability benchmark is still a plain EvalSet on disk
    and can be loaded by EvalSet.from_file().
    """

    id: str
    query: str
    fault: FaultSpec
    llm_script: list[list[dict[str, Any]]]
    tool_effect_class: str = "external_write"
    expected_total_effects: int = 1
    expect_resume_success: bool = True
    expect_error_diagnosable: bool = False

    def to_eval_case(self) -> EvalCase:
        return EvalCase(
            id=self.id,
            query=self.query,
            metadata={
                "reliability": {
                    "fault": {
                        "kind": self.fault.kind.value,
                        "at_call_index": self.fault.at_call_index,
                        "tool_name": self.fault.tool_name,
                    },
                    "llm_script": self.llm_script,
                    "tool_effect_class": self.tool_effect_class,
                    "expected_total_effects": self.expected_total_effects,
                    "expect_resume_success": self.expect_resume_success,
                    "expect_error_diagnosable": self.expect_error_diagnosable,
                }
            },
        )

    @classmethod
    def from_eval_case(cls, case: EvalCase) -> "ReliabilityCase":
        meta = dict((case.metadata or {}).get("reliability") or {})
        raw_fault = dict(meta.get("fault") or {})
        kind = FaultKind(str(raw_fault.get("kind") or FaultKind.KILL_BEFORE_TOOL_RESULT))
        return cls(
            id=case.id,
            query=case.query,
            fault=FaultSpec(
                kind=kind,
                at_call_index=int(raw_fault.get("at_call_index", 1) or 0),
                tool_name=raw_fault.get("tool_name"),
            ),
            llm_script=list(meta.get("llm_script") or []),
            tool_effect_class=str(meta.get("tool_effect_class") or "external_write"),
            expected_total_effects=int(meta.get("expected_total_effects") or 1),
            expect_resume_success=bool(meta.get("expect_resume_success", True)),
            expect_error_diagnosable=bool(meta.get("expect_error_diagnosable", False)),
        )


@dataclass
class ReliabilityMetrics:
    """The four numbers that define SDK reliability on this bench."""

    total_cases: int
    duplicate_side_effect_rate: float
    crash_recovery_success_rate: float
    history_consistency_rate: float
    error_diagnosability_rate: float
    per_case: list[dict[str, Any]] = field(default_factory=list)

    def to_report(self) -> str:
        lines = [
            "═══════════════════════════════════════════",
            "可靠性基准报告: agenticx-reliability-v1",
            "═══════════════════════════════════════════",
            "",
            "指标方向：duplicate_side_effect_rate 越低越好（目标 0.0）；",
            "crash_recovery_success_rate / history_consistency_rate /",
            "error_diagnosability_rate 越高越好（目标 1.0）。",
            "",
            f"  - 用例数: {self.total_cases}",
            f"  - 重复副作用率: {self.duplicate_side_effect_rate:.4f}",
            f"  - 崩溃恢复成功率: {self.crash_recovery_success_rate:.4f}",
            f"  - 历史一致率: {self.history_consistency_rate:.4f}",
            f"  - 错误可诊断率: {self.error_diagnosability_rate:.4f}",
            "",
            "本基准为**进程内模拟崩溃**（在指定边界抛不可捕获异常并丢弃内存态，从磁盘状态重建），非真实进程 kill。指标反映\"内存态丢失后磁盘态能否独立支撑正确恢复\"，不覆盖 OS 级页缓存丢失、磁盘损坏等物理故障。",
            "═══════════════════════════════════════════",
        ]
        return "\n".join(lines)


class ReliabilityRunner:
    """Drives ReActAgent through fault-injection cases.

    Sibling of EvalRunner (which is duck-typed on execute_async and cannot
    drive ReActAgent); reuses EvalSet/EvalCase/EvalResult data models and
    TrajectoryMatcher, but owns its own execution loop.
    """

    def __init__(self, *, root: Path, verbose: bool = False) -> None:
        self.root = Path(root)
        self.verbose = verbose

    def run(self, evalset: EvalSet) -> ReliabilityMetrics:
        return asyncio.run(self.run_async(evalset))

    async def run_async(self, evalset: EvalSet) -> ReliabilityMetrics:
        per_case = [
            await self.run_case_async(ReliabilityCase.from_eval_case(case))
            for case in evalset.cases
        ]
        return _summarize(per_case)

    async def run_case_async(self, case: ReliabilityCase) -> dict[str, Any]:
        self.root.mkdir(parents=True, exist_ok=True)
        counter = SideEffectCounter()
        injector = FaultInjector(case.fault)
        tool = CountingTool(
            counter,
            effect_class=case.tool_effect_class,
            injector=injector,
        )
        ledger = CallLedger(case.id, root=self.root)
        run_store = RunStateStore(case.id, root=self.root)
        llm = ScriptedFakeLLM(
            case.llm_script,
            injector=injector if case.fault.kind is FaultKind.LLM_TIMEOUT_MID_STREAM else None,
            inject_tool_name=tool.name,
        )
        _install_hooks(case, injector, tool, ledger, run_store)
        agent = ReActAgent(
            llm=llm,
            tools=[tool],
            system_prompt="reliability bench",
            session_id=case.id,
            run_store=run_store,
            call_ledger=ledger,
        )

        phase1: list[Any] = []
        crash_exc: BaseException | None = None
        try:
            async for event in agent.astream(case.query):
                phase1.append(event)
        except (
            _InjectedCrash,
            OSError,
            asyncio.TimeoutError,
            ToolCallIdentityError,
        ) as exc:
            crash_exc = exc

        # Drop in-memory objects so disk is the only source of truth.
        # Reuse tool/counter: real external effects do not roll back on death.
        del agent, ledger, run_store, llm

        ledger2 = CallLedger.load(case.id, root=self.root)
        store2 = RunStateStore(case.id, root=self.root)
        phase2: list[Any] = []
        resume_exc: BaseException | None = None
        existing = store2.load()
        phase1_final = next(
            (event for event in reversed(phase1) if isinstance(event, FinalEvent)),
            None,
        )
        if existing is None and crash_exc is None and phase1_final and phase1_final.success:
            # Successful runs clear RunState; there is nothing left to resume.
            phase2 = [phase1_final]
        else:
            llm2 = ScriptedFakeLLM(case.llm_script)
            agent2 = ReActAgent(
                llm=llm2,
                tools=[tool],
                system_prompt="reliability bench",
                session_id=case.id,
                run_store=store2,
                call_ledger=ledger2,
            )
            try:
                async for event in agent2.aresume():
                    phase2.append(event)
            except Exception as exc:
                resume_exc = exc

        final = next(
            (event for event in reversed(phase2) if isinstance(event, FinalEvent)),
            None,
        )
        resume_ok = (
            resume_exc is None and final is not None and bool(final.success)
        )
        messages = list(final.messages) if final is not None else []
        history_ok = check_history_consistency(messages) if resume_ok else False

        visible = _collect_visible(phase1, phase2, crash_exc, resume_exc, tool.name)
        diagnosable = _is_diagnosable("\n".join(visible), tool_name=tool.name)

        return {
            "id": case.id,
            "expected_total_effects": case.expected_total_effects,
            "expect_resume_success": case.expect_resume_success,
            "expect_error_diagnosable": case.expect_error_diagnosable,
            "effects_total": len(counter.records),
            "duplicates": counter.duplicate_count,
            "resume_ok": resume_ok,
            "history_ok": history_ok,
            "diagnosable": diagnosable,
            "crashed": crash_exc is not None,
            "error": None if crash_exc is None else f"{tool.name}: {crash_exc}",
        }


def _install_hooks(
    case: ReliabilityCase,
    injector: FaultInjector,
    tool: CountingTool,
    ledger: CallLedger,
    run_store: RunStateStore,
) -> None:
    kind = case.fault.kind
    tool_name = tool.name
    if kind is FaultKind.KILL_AFTER_TOOL_RESULT_BEFORE_PERSIST:
        original = ledger.record_result
        seen = {"n": 0}

        def _wrapped_result(call_id: str, result: str, *, success: bool = True) -> None:
            original(call_id, result, success=success)
            seen["n"] += 1
            if injector.should_fire(
                boundary="after_result",
                call_index=seen["n"],
                tool_name=tool_name,
            ):
                raise _InjectedCrash("kill_after_result")

        ledger.record_result = _wrapped_result  # type: ignore[method-assign]
    elif kind is FaultKind.PERSIST_FAILURE:
        original_save = run_store.save

        def _wrapped_save(state: Any) -> None:
            if injector.should_fire(
                boundary="persist",
                call_index=1,
                tool_name=tool_name,
            ):
                raise OSError(f"{tool_name} 持久化失败: RunStateStore.save")
            original_save(state)

        run_store.save = _wrapped_save  # type: ignore[method-assign]


def _collect_visible(
    phase1: list[Any],
    phase2: list[Any],
    crash_exc: BaseException | None,
    resume_exc: BaseException | None,
    tool_name: str,
) -> list[str]:
    texts: list[str] = []
    for event in (*phase1, *phase2):
        if isinstance(event, ErrorEvent):
            texts.append(event.message)
        if isinstance(event, FinalEvent):
            for row in event.messages:
                if row.get("role") != "tool":
                    continue
                meta = row.get("metadata") or {}
                if meta.get("kind") == KIND_OUTCOME_UNKNOWN:
                    texts.append(str(row.get("content") or ""))
    if crash_exc is not None:
        texts.append(f"{tool_name} 参数不一致: {crash_exc}")
    if resume_exc is not None:
        texts.append(f"{tool_name}: {resume_exc}")
    return texts


def _summarize(per_case: list[dict[str, Any]]) -> ReliabilityMetrics:
    total = len(per_case)
    expected_effects = sum(int(row["expected_total_effects"]) for row in per_case) or 1
    duplicates = sum(int(row["duplicates"]) for row in per_case)
    resume_expected = [row for row in per_case if row["expect_resume_success"]]
    resume_ok = [row for row in resume_expected if row["resume_ok"]]
    recovered = [row for row in per_case if row["resume_ok"]]
    diag_expected = [row for row in per_case if row["expect_error_diagnosable"]]
    diag_ok = [row for row in diag_expected if row["diagnosable"]]
    history_ok = [row for row in recovered if row["history_ok"]]
    return ReliabilityMetrics(
        total_cases=total,
        duplicate_side_effect_rate=duplicates / expected_effects,
        crash_recovery_success_rate=(
            len(resume_ok) / len(resume_expected) if resume_expected else 1.0
        ),
        history_consistency_rate=(
            len(history_ok) / len(recovered) if recovered else 1.0
        ),
        error_diagnosability_rate=(
            len(diag_ok) / len(diag_expected) if diag_expected else 1.0
        ),
        per_case=per_case,
    )
