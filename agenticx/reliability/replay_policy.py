#!/usr/bin/env python3
"""Layered vetoes for whether an interrupted tool call may re-run.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from agenticx.reliability.call_ledger import Verdict

ReplayAction = Literal["replay", "skip_use_recorded", "mark_unknown", "abort"]

_SOFT_VETOES = {
    "external_write": "external_side_effect",
    "unknown": "unknown_side_effect",
    "local_write": "local_write_ambiguous",
}


@dataclass(frozen=True)
class ReplayRequest:
    """Everything needed to decide whether one interrupted call may re-run."""

    call_id: str
    tool_name: str
    arguments: dict[str, Any]
    ledger_verdict: Verdict
    effect_class: str
    output_already_emitted: bool = False
    request_is_streaming: bool = False
    approve_unsafe_replay: bool = False


@dataclass(frozen=True)
class ReplayDecision:
    action: ReplayAction
    veto: str | None
    reason: str
    approved_override: bool = False


def _ignore_approval(base: str, approved: bool) -> str:
    if approved:
        return f"授权已忽略，因为 {base}"
    return base


def decide_replay(req: ReplayRequest) -> ReplayDecision:
    """Return a layered veto decision. Earlier rows short-circuit."""
    tool = req.tool_name

    if req.ledger_verdict is Verdict.IDENTITY_CONFLICT:
        base = (
            f"工具 {tool} 的调用 {req.call_id} 参数与账本记录不一致，无法安全恢复"
        )
        return ReplayDecision(
            action="abort",
            veto="identity_conflict",
            reason=_ignore_approval(base, req.approve_unsafe_replay),
        )

    if req.output_already_emitted:
        return ReplayDecision(
            action="mark_unknown",
            veto="output_already_emitted",
            reason=f"本轮输出已发给用户，不能重跑 {tool}（授权已忽略）",
        )

    if (
        req.request_is_streaming
        and not req.output_already_emitted
        and req.ledger_verdict is Verdict.AMBIGUOUS
    ):
        base = f"本轮为流式请求且 {tool} 结果未知，不能重跑"
        return ReplayDecision(
            action="mark_unknown",
            veto="streaming_request",
            reason=_ignore_approval(base, req.approve_unsafe_replay),
        )

    if req.ledger_verdict is Verdict.REPLAY_SKIP:
        return ReplayDecision(
            action="skip_use_recorded",
            veto=None,
            reason=f"{tool} 已在中断前完成，复用已记录结果",
        )

    # FRESH means record_dispatch never fsynced — no side effect happened.
    if req.ledger_verdict is Verdict.FRESH:
        return ReplayDecision(
            action="replay",
            veto=None,
            reason=f"{tool} 未成功派发，可安全重跑",
        )

    if req.effect_class in {"none", "read"}:
        return ReplayDecision(
            action="replay",
            veto=None,
            reason=f"{tool} 为只读操作，可安全重跑",
        )

    veto = _SOFT_VETOES.get(req.effect_class, "unknown_side_effect")
    if req.approve_unsafe_replay:
        return ReplayDecision(
            action="replay",
            veto=veto,
            reason=f"调用方显式授权重放 {tool}（原否决：{veto}）",
            approved_override=True,
        )

    if veto == "external_side_effect":
        reason = f"{tool} 会产生外部副作用且执行结果未知，已跳过重跑"
    elif veto == "unknown_side_effect":
        reason = f"{tool} 的副作用未知（未声明 effect_class），保守跳过重跑"
    else:
        reason = f"{tool} 会写入本地且执行结果未知，已跳过重跑"
    return ReplayDecision(action="mark_unknown", veto=veto, reason=reason)
