#!/usr/bin/env python3
"""Handoff summary generation (SP4).

The eight-section summary is a fixed contract (no adapter free-styling).
Providers are pluggable:

- :class:`TemplateSummarizer` -- local, deterministic, rule-based
  extraction from the AppThread snapshot. Default; no egress.
- external providers (LLM-backed) receive only the allowlisted egress
  view (see :mod:`agenticx.harness.handoff.security`); a provider that
  violates the allowlist is disabled and the engine falls back to the
  template summarizer (fail closed).

memory / knowledge snapshots are mandatory injection points but default
to local-only (never egressed to external providers unless explicitly
allowed).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from agenticx.harness.handoff.types import (
    STRATEGY_DELTA,
    STRATEGY_FULL,
    STRATEGY_MANUAL,
    STRATEGY_RESUME,
    AppThreadSnapshot,
    HandoffSummary,
    SwitchPlan,
)

_MAX_SECTION_CHARS = 2000
_MAX_EXCERPT_CHARS = 400
_MAX_ITEMS_PER_SECTION = 12


@dataclass
class SummarizationResult:
    summary: HandoffSummary
    provider_id: str


class SummarizationProvider:
    """Protocol for summary providers (template / LLM / future)."""

    provider_id = "abstract"

    def summarize(
        self,
        snapshot: AppThreadSnapshot,
        plan: SwitchPlan,
        manual_context: Optional[str] = None,
    ) -> SummarizationResult:  # pragma: no cover - protocol
        raise NotImplementedError


def _clip(text: str, limit: int = _MAX_SECTION_CHARS) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


class TemplateSummarizer(SummarizationProvider):
    """Deterministic local extraction into the fixed eight sections."""

    provider_id = "template-local-v1"

    def summarize(
        self,
        snapshot: AppThreadSnapshot,
        plan: SwitchPlan,
        manual_context: Optional[str] = None,
    ) -> SummarizationResult:
        if plan.strategy == STRATEGY_MANUAL:
            summary = HandoffSummary(
                goal=_clip(manual_context or "(no manual context provided)")
            )
            summary.memory_snapshot = snapshot.memory_snapshot
            summary.knowledge_snapshot = snapshot.knowledge_snapshot
            return SummarizationResult(summary, self.provider_id)

        # Delta window: only messages the target has not seen yet; full
        # window: everything. The goal section always comes from the very
        # first user message so the objective survives any strategy.
        history = snapshot.history
        window = history[plan.delta_from_position : plan.delta_to_position]

        first_user = next(
            (m for m in history if m.role == "user"), None
        )
        goal = _clip(first_user.content if first_user else "(no user goal recorded)")

        decisions = _recent_assistant_excerpt(window)
        changed_files = _changed_files(snapshot, plan)
        commands_and_tests = _commands_and_tests(snapshot, plan)
        plan_todos = _clip(snapshot.todos) if snapshot.todos else "(none recorded)"
        open_approvals = "(none recorded)"
        checkpoint = _checkpoint(snapshot, plan)
        known_failures = _known_failures(snapshot, plan)

        summary = HandoffSummary(
            goal=goal,
            decisions=decisions,
            changed_files=changed_files,
            commands_and_tests=commands_and_tests,
            plan_and_todos=plan_todos,
            open_approvals=open_approvals,
            checkpoint_diff=checkpoint,
            known_failures=known_failures,
            memory_snapshot=snapshot.memory_snapshot,
            knowledge_snapshot=snapshot.knowledge_snapshot,
        )
        return SummarizationResult(summary, self.provider_id)


def _recent_assistant_excerpt(window: List[object]) -> str:
    excerpts: List[str] = []
    for message in reversed(window):
        if getattr(message, "role", "") != "assistant":
            continue
        content = (getattr(message, "content", "") or "").strip()
        if not content:
            continue
        excerpt = _clip(content, _MAX_EXCERPT_CHARS)
        excerpts.append(f"- {excerpt}")
        if len(excerpts) >= 3:
            break
    if not excerpts:
        return "(none recorded)"
    return "\n".join(reversed(excerpts))


def _runs_in_window(
    snapshot: AppThreadSnapshot, plan: SwitchPlan
) -> List[object]:
    return [
        run
        for run in snapshot.runs
        if plan.delta_from_position
        < getattr(run, "end_position", 0)
        <= plan.delta_to_position
    ]


def _changed_files(snapshot: AppThreadSnapshot, plan: SwitchPlan) -> str:
    files: List[str] = []
    for run in _runs_in_window(snapshot, plan):
        for path in getattr(run, "changed_files", []) or []:
            if path not in files:
                files.append(path)
            if len(files) >= _MAX_ITEMS_PER_SECTION:
                break
    if not files:
        return "(none recorded)"
    return "\n".join(f"- {path}" for path in files)


def _commands_and_tests(
    snapshot: AppThreadSnapshot, plan: SwitchPlan
) -> str:
    lines: List[str] = []
    for run in _runs_in_window(snapshot, plan):
        for command in (getattr(run, "commands", []) or [])[
            :_MAX_ITEMS_PER_SECTION
        ]:
            lines.append(f"- $ {_clip(command, 160)}")
        for test in (getattr(run, "tests", []) or [])[:_MAX_ITEMS_PER_SECTION]:
            status = getattr(run, "status", "")
            lines.append(f"- test {test} ({status})")
    if not lines:
        return "(none recorded)"
    return "\n".join(lines[:_MAX_ITEMS_PER_SECTION])


def _checkpoint(snapshot: AppThreadSnapshot, plan: SwitchPlan) -> str:
    runs = _runs_in_window(snapshot, plan)
    total_files = sum(len(getattr(run, "changed_files", []) or []) for run in runs)
    scope = (
        "full thread"
        if plan.delta_from_position == 0
        else f"delta since message {plan.delta_from_position}"
    )
    return (
        f"{len(runs)} run(s) in scope ({scope}); "
        f"{total_files} file(s) changed."
    )


def _known_failures(snapshot: AppThreadSnapshot, plan: SwitchPlan) -> str:
    failures: List[str] = []
    for run in _runs_in_window(snapshot, plan):
        if getattr(run, "status", "") != "failed":
            continue
        name = getattr(run, "run_id", "") or "(run)"
        failures.append(f"- run {name} failed")
    if not failures:
        return "(none recorded)"
    return "\n".join(failures[:_MAX_ITEMS_PER_SECTION])
