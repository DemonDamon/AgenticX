#!/usr/bin/env python3
"""Session loop review — a deterministic, read-only health check for one session.

Scores a completed session along five dimensions of the agent work loop, where
each dimension's score is *capped* by the strength of the evidence behind it
(see ``evidence.py``). Findings are generated independently of scores and only
when a concrete repair action plus a verification path can be stated.

Inputs (read-only):
- ``<session_dir>/tool_call_observations.json``
- ``<session_dir>/messages.json``

Output (only via explicit ``write_review``):
- ``<session_dir>/loop_review.json``

No LLM calls. No network. No mutation of anything other than the report file.

Author: Damon Li
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.learning.analyzer import extract_signals, load_session_observations
from agenticx.learning.evidence import (
    EvidenceState,
    cap_score,
    classify_delivery_evidence,
    classify_validation_evidence,
    collect_session_evidence,
)

SCHEMA_VERSION = 1
REVIEW_FILENAME = "loop_review.json"
MESSAGES_FILENAME = "messages.json"


@dataclass
class DimensionReview:
    key: str
    label: str
    raw_score: int
    score: int  # after evidence cap
    evidence: str  # EvidenceState.value
    rationale: str  # one line: where the score came from


@dataclass
class LoopReview:
    session_id: str
    generated_at: str  # ISO8601 UTC
    schema_version: int = SCHEMA_VERSION
    dimensions: list[DimensionReview] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)
    overall: int = 0  # floor of the mean of the five dimension scores


# Findings are decoupled from scores: a low score alone never produces one.
# A finding exists only when evidence is insufficient AND a bounded repair plus
# a verification path can be stated verbatim (fixed copy, no free generation).
FINDING_TEMPLATES: dict[str, dict[str, str]] = {
    "change_validation": {
        "impact": "本次会话产生了写操作但未观察到验证动作",
        "repair": "在收尾轮追加一次测试/类型检查工具调用",
        "verification": "重跑会话后 change_validation.evidence 应达到 exercised",
    },
    "reliable_delivery": {
        "impact": "会话缺少用户确认或存在纠偏轮次",
        "repair": "收尾时向用户复述交付物与验收口径",
        "verification": "user_correction_turns 归零",
    },
    "learning_capture": {
        "impact": "复杂会话未沉淀任何技能",
        "repair": "会话结束后触发一次 skill_manage 复盘",
        "verification": "learning_capture.evidence 达到 exercised",
    },
}


def _load_messages(session_dir: Path) -> tuple[list[dict[str, Any]], bool]:
    """Read messages.json tolerantly; missing/corrupt file is not an error."""
    path = session_dir / MESSAGES_FILENAME
    if not path.is_file():
        return [], False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, ValueError, OSError):
        return [], False
    if isinstance(data, list):
        return [m for m in data if isinstance(m, dict)], True
    if isinstance(data, dict) and isinstance(data.get("messages"), list):
        return [m for m in data["messages"] if isinstance(m, dict)], True
    return [], False


def _score_task_framing(ev, signals) -> tuple[int, str]:
    raw = 40
    parts = ["base 40"]
    if ev.user_turns >= 1:
        raw += 30
        parts.append("首轮用户意图存在 +30")
    if ev.user_turns >= 2 and ev.user_correction_turns == 0:
        raw += 30
        parts.append("无纠偏轮次 +30")
    elif ev.user_correction_turns > 0:
        raw += 10
        parts.append(f"存在 {ev.user_correction_turns} 轮纠偏 +10")
    return min(raw, 100), "；".join(parts)


def _score_controlled_execution(ev, signals) -> tuple[int, str]:
    if signals.tool_call_count == 0:
        return 30, "无工具调用"
    error_ratio = signals.error_count / signals.tool_call_count
    raw = int(round((1.0 - error_ratio) * 80)) + 20
    parts = [f"{signals.tool_call_count} 次调用，错误率 {error_ratio:.0%}"]
    if ev.confirm_events > 0:
        raw += 5
        parts.append(f"{ev.confirm_events} 次高风险确认 +5")
    return min(raw, 100), "；".join(parts)


def _score_change_validation(ev, signals) -> tuple[int, str]:
    if ev.write_calls == 0:
        if not ev.observations_available:
            return 20, "无可观测数据"
        return 100, "无写操作，无需验证"
    if ev.verification_success > 0:
        # Writes exist and at least one verifier passed afterwards: the work was
        # verified. Ratio-of-writes coverage is a refinement, not the headline.
        raw = 90 + min(10, int(round(ev.verification_success * 2)))
        return min(raw, 100), (
            f"{ev.verification_success} 次验证成功 / {ev.write_calls} 次写操作"
        )
    if ev.verification_calls > 0:
        return 60, f"验证执行了但未成功（{ev.verification_calls} 次）"
    return 65, f"{ev.write_calls} 次写操作，未观察到任何验证动作"


def _score_reliable_delivery(ev, signals) -> tuple[int, str]:
    if signals.tool_call_count == 0 and ev.user_turns == 0:
        return 30, "无交付证据"
    raw = int(round(signals.success_rate * 70)) + 20
    parts = [f"成功率 {signals.success_rate:.0%}"]
    if ev.user_turns >= 2 and ev.user_correction_turns == 0:
        raw += 10
        parts.append("用户无纠偏 +10")
    return min(raw, 100), "；".join(parts)


def _score_learning_capture(ev, signals, observations) -> tuple[int, str]:
    if not observations:
        return 30, "无可观测数据"
    used_skill_manage = any(
        str(o.get("tool_name", "")) == "skill_manage" for o in observations
    )
    if used_skill_manage:
        return 90, "会话内调用了 skill_manage"
    if signals.is_complex:
        return 40, "复杂会话但未沉淀技能"
    return 70, "轻量会话，沉淀非必需"


def review_session(session_dir: Path) -> LoopReview:
    """Compute the five-dimension review for one session directory."""
    session_dir = Path(session_dir)
    observations = load_session_observations(session_dir)
    messages, messages_available = _load_messages(session_dir)

    signals = extract_signals(observations)
    ev = collect_session_evidence(observations, messages)
    if not messages_available:
        ev.messages_available = False

    validation_state = classify_validation_evidence(ev)
    delivery_state = classify_delivery_evidence(ev)

    dimensions: list[DimensionReview] = []

    raw, why = _score_task_framing(ev, signals)
    dimensions.append(
        DimensionReview("task_framing", "任务理解", raw, cap_score(raw, delivery_state), delivery_state.value, why)
    )
    if ev.user_turns == 0 and not ev.messages_available:
        dimensions[0].evidence = EvidenceState.UNOBSERVED.value
        dimensions[0].score = cap_score(dimensions[0].raw_score, EvidenceState.UNOBSERVED)

    raw, why = _score_controlled_execution(ev, signals)
    exec_state = EvidenceState.EXERCISED if ev.observations_available else EvidenceState.UNOBSERVED
    dimensions.append(
        DimensionReview("controlled_execution", "受控执行", raw, cap_score(raw, exec_state), exec_state.value, why)
    )

    raw, why = _score_change_validation(ev, signals)
    dimensions.append(
        DimensionReview("change_validation", "变更验证", raw, cap_score(raw, validation_state), validation_state.value, why)
    )

    raw, why = _score_reliable_delivery(ev, signals)
    dimensions.append(
        DimensionReview("reliable_delivery", "可靠交付", raw, cap_score(raw, delivery_state), delivery_state.value, why)
    )

    raw, why = _score_learning_capture(ev, signals, observations)
    if not ev.observations_available:
        learn_state = EvidenceState.UNOBSERVED
    elif any(str(o.get("tool_name", "")) == "skill_manage" for o in observations):
        learn_state = EvidenceState.EXERCISED
    else:
        learn_state = EvidenceState.PRESENT
    dimensions.append(
        DimensionReview("learning_capture", "学习沉淀", raw, cap_score(raw, learn_state), learn_state.value, why)
    )

    overall = sum(d.score for d in dimensions) // len(dimensions) if dimensions else 0

    findings: list[dict[str, Any]] = []
    weak = {EvidenceState.MISSING, EvidenceState.PRESENT}
    for dim in dimensions:
        tpl = FINDING_TEMPLATES.get(dim.key)
        if not tpl:
            continue
        try:
            state = EvidenceState(dim.evidence)
        except ValueError:
            continue
        if state in weak:
            findings.append(
                {
                    "key": dim.key,
                    "impact": tpl["impact"],
                    "repair": tpl["repair"],
                    "verification": tpl["verification"],
                }
            )

    return LoopReview(
        session_id=session_dir.name,
        generated_at=datetime.now(timezone.utc).isoformat(),
        dimensions=dimensions,
        findings=findings,
        overall=overall,
    )


def write_review(review: LoopReview, session_dir: Path) -> Path:
    """Persist ``<session_dir>/loop_review.json``; returns the path."""
    session_dir = Path(session_dir)
    session_dir.mkdir(parents=True, exist_ok=True)
    path = session_dir / REVIEW_FILENAME
    path.write_text(
        json.dumps(asdict(review), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def format_review_text(review: LoopReview) -> str:
    """Plain-text rendering for the CLI (no rich tables)."""
    lines = [
        f"Session {review.session_id}  ·  {review.generated_at}",
        f"Overall {review.overall} / 100",
        "",
    ]
    for d in review.dimensions:
        capped = "  ← 已按证据封顶" if d.score < d.raw_score else ""
        lines.append(f"{d.label:<10} {d.score:>3}   evidence={d.evidence}{capped}")
        lines.append(f"             {d.rationale}")
    lines.append("")
    if review.findings:
        lines.append(f"Findings ({len(review.findings)})")
        for f in review.findings:
            lines.append(f"[{f['key']}]")
            lines.append(f"  影响：{f['impact']}")
            lines.append(f"  修复：{f['repair']}")
            lines.append(f"  验证：{f['verification']}")
    else:
        lines.append("Findings (0)")
        lines.append("未发现需要修复的问题")
    return "\n".join(lines)
