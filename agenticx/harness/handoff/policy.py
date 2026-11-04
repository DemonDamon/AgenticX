#!/usr/bin/env python3
"""Handoff strategy selection (SP4).

Four-tier ladder (master plan section 5 + SP4):

1. ``resume``      target harness previously owned this thread and its
                   native thread id survives -> adopt it and inject only
                   the delta since that harness last saw the thread
2. ``delta``       new thread on the target harness, but the target (or
                   the thread) has seen most of the history -> inject
                   only the delta since the last seen position
3. ``full_summary`` new thread and stale/never-seen history -> inject
                   the full eight-section summary (also the automatic
                   downgrade when delta is too large to be trustworthy)
4. ``manual_context`` the user hand-writes the context (fallback)

Staleness: when the delta window exceeds the configured budget (message
count), ``delta`` auto-downgrades to ``full_summary``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from agenticx.harness.handoff.types import (
    STRATEGIES,
    STRATEGY_DELTA,
    STRATEGY_FULL,
    STRATEGY_MANUAL,
    STRATEGY_RESUME,
    AppThreadSnapshot,
    HandoffPlanError,
    SwitchPlan,
    ThreadBinding,
)


@dataclass
class HandoffPolicyConfig:
    # Delta windows larger than this many messages auto-downgrade to a
    # full summary (staleness guard).
    max_delta_messages: int = 40


def _latest_position(snapshot: AppThreadSnapshot) -> int:
    return len(snapshot.history)


def _binding_for(
    snapshot: AppThreadSnapshot, harness: str
) -> Optional[ThreadBinding]:
    for binding in snapshot.threads:
        if binding.harness == harness:
            return binding
    return None


def decide_strategy(
    snapshot: AppThreadSnapshot,
    target_harness: str,
    config: Optional[HandoffPolicyConfig] = None,
    user_strategy: Optional[str] = None,
) -> SwitchPlan:
    """Choose the handoff strategy. ``user_strategy`` (from the picker /
    switch UI) is honored when feasible; infeasible explicit choices
    raise :class:`HandoffPlanError` so the UI can fail closed and stay on
    the current harness."""
    cfg = config or HandoffPolicyConfig()
    latest = _latest_position(snapshot)
    target_harness = (target_harness or "").strip()
    if not target_harness:
        raise HandoffPlanError("target harness is empty")
    if user_strategy is not None and user_strategy not in STRATEGIES:
        raise HandoffPlanError(f"unknown strategy: {user_strategy!r}")

    binding = _binding_for(snapshot, target_harness)

    # ------------------------------------------------------- manual tier
    if user_strategy == STRATEGY_MANUAL:
        return SwitchPlan(
            strategy=STRATEGY_MANUAL,
            target_harness=target_harness,
            delta_from_position=0,
            delta_to_position=latest,
            reason="user-provided manual context",
        )

    # ------------------------------------------------------- resume tier
    if user_strategy == STRATEGY_RESUME:
        if binding is None or not binding.native_thread_id:
            raise HandoffPlanError(
                f"cannot resume {target_harness}: no surviving native thread"
            )
        delta_from = binding.last_seen_position
        return SwitchPlan(
            strategy=STRATEGY_RESUME,
            target_harness=target_harness,
            resume_native_thread_id=binding.native_thread_id,
            delta_from_position=delta_from,
            delta_to_position=latest,
            reason=f"resume {target_harness} native thread "
            f"{binding.native_thread_id}",
        )

    if user_strategy == STRATEGY_FULL:
        return SwitchPlan(
            strategy=STRATEGY_FULL,
            target_harness=target_harness,
            delta_from_position=0,
            delta_to_position=latest,
            reason="user requested full summary",
        )
    if user_strategy == STRATEGY_DELTA:
        if binding is None:
            raise HandoffPlanError(
                f"cannot build delta for {target_harness}: never seen"
            )
        return SwitchPlan(
            strategy=STRATEGY_DELTA,
            target_harness=target_harness,
            delta_from_position=binding.last_seen_position,
            delta_to_position=latest,
            reason=f"delta since position {binding.last_seen_position}",
        )

    # ------------------------------------------------------------ auto
    notes = []
    if binding is not None and binding.native_thread_id:
        # resume tier: adopt the native thread, inject only the delta
        return SwitchPlan(
            strategy=STRATEGY_RESUME,
            target_harness=target_harness,
            resume_native_thread_id=binding.native_thread_id,
            delta_from_position=binding.last_seen_position,
            delta_to_position=latest,
            reason=f"auto: {target_harness} owns a resumable native thread",
        )

    if binding is not None:
        delta_size = latest - binding.last_seen_position
        if delta_size <= cfg.max_delta_messages:
            return SwitchPlan(
                strategy=STRATEGY_DELTA,
                target_harness=target_harness,
                delta_from_position=binding.last_seen_position,
                delta_to_position=latest,
                reason=f"auto: delta of {delta_size} messages is small",
            )
        notes.append(
            f"delta of {delta_size} messages exceeds budget "
            f"{cfg.max_delta_messages}; downgraded to full summary"
        )

    return SwitchPlan(
        strategy=STRATEGY_FULL,
        target_harness=target_harness,
        delta_from_position=0,
        delta_to_position=latest,
        reason="auto: no resumable thread"
        + ("" if binding is None else "; stale delta"),
        notes=notes,
    )
