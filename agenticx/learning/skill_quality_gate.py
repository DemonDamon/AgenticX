#!/usr/bin/env python3
"""Skill quality gate — evaluate proposed skills before creation.

Runs a battery of deterministic checks to filter out low-quality or
redundant skills before they are written to disk.

Checks:
  1. min_steps — session must have had enough tool calls to warrant a skill
  2. success_evidence — at least one successful tool invocation in the session
  3. dedup — proposed description must not overlap heavily with existing skills
  4. guard_scan — content must pass the security scanner
  5. actionability — SKILL.md must have frontmatter and non-trivial body

Upstream reference: hermes-agent proposal v2 §4.2.2.

Author: Damon Li
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

logger = logging.getLogger("agenticx.learning")

MIN_TOOL_CALLS_DEFAULT = 5
MIN_BODY_CHARS = 80
DEDUP_THRESHOLD = 0.85
GATE_MIN_SCORE = 0.6


@dataclass
class QualityCheck:
    """Single check result."""

    name: str
    passed: bool
    reason: str
    score: float


@dataclass
class GateResult:
    """Aggregate gate decision."""

    passed: bool
    reason: str
    score: float
    checks: list[QualityCheck]


def _check_min_steps(
    observations: list[dict[str, Any]],
    min_calls: int = MIN_TOOL_CALLS_DEFAULT,
) -> QualityCheck:
    """The session must have involved enough tool calls."""
    n = len(observations)
    if n >= min_calls:
        return QualityCheck("min_steps", True, f"{n} tool calls", 1.0)
    return QualityCheck("min_steps", False, f"only {n} calls (need {min_calls})", 0.0)


def _check_success_evidence(observations: list[dict[str, Any]]) -> QualityCheck:
    """At least one successful tool call should be present."""
    successes = sum(1 for o in observations if o.get("success", False))
    if successes > 0:
        return QualityCheck("success_evidence", True, f"{successes} successes", 1.0)
    return QualityCheck("success_evidence", False, "no successful tool calls", 0.0)


def _check_dedup(
    proposed_description: str,
    existing_skills: list[dict[str, Any]],
    threshold: float = DEDUP_THRESHOLD,
) -> QualityCheck:
    """Proposed skill description must not be too similar to an existing one."""
    if not proposed_description or not existing_skills:
        return QualityCheck("dedup", True, "no overlap (empty input)", 1.0)
    best_ratio = 0.0
    best_name = ""
    proposed_lower = proposed_description.lower().strip()
    for skill in existing_skills:
        desc = str(skill.get("description", "")).lower().strip()
        if not desc:
            continue
        ratio = SequenceMatcher(None, proposed_lower, desc).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_name = str(skill.get("name", ""))
    if best_ratio >= threshold:
        return QualityCheck(
            "dedup",
            False,
            f"too similar to '{best_name}' ({best_ratio:.0%})",
            0.0,
        )
    return QualityCheck("dedup", True, f"best overlap {best_ratio:.0%}", 1.0)


def _check_guard_scan(content: str) -> QualityCheck:
    """Run the security scanner on the proposed SKILL.md text."""
    try:
        from agenticx.skills.guard import scan_skill_markdown_text, should_allow

        result = scan_skill_markdown_text(content, source="agent-created")
        allowed, reason = should_allow(result)
        if allowed:
            return QualityCheck("guard_scan", True, reason, 1.0)
        return QualityCheck("guard_scan", False, reason, 0.0)
    except Exception as exc:
        logger.warning("Guard scan failed: %s", exc)
        return QualityCheck("guard_scan", True, "scan unavailable, allowing", 0.8)


def _check_actionability(content: str) -> QualityCheck:
    """SKILL.md must have valid frontmatter and a non-trivial body."""
    if not content or not content.strip():
        return QualityCheck("actionability", False, "empty content", 0.0)
    if not content.strip().startswith("---"):
        return QualityCheck("actionability", False, "missing frontmatter", 0.0)
    end = re.search(r"\n---\s*\n", content[3:])
    if not end:
        return QualityCheck("actionability", False, "unclosed frontmatter", 0.0)
    body = content[3 + end.end() :].strip()
    if len(body) < MIN_BODY_CHARS:
        return QualityCheck(
            "actionability",
            False,
            f"body too short ({len(body)} chars, need {MIN_BODY_CHARS})",
            0.3,
        )
    return QualityCheck("actionability", True, f"body {len(body)} chars", 1.0)


def evaluate(
    proposed_content: str,
    proposed_description: str,
    existing_skills: list[dict[str, Any]],
    session_observations: list[dict[str, Any]],
    *,
    min_score: float = GATE_MIN_SCORE,
) -> GateResult:
    """Run all quality checks and return an aggregate decision.

    Returns ``GateResult`` with ``passed=True`` only when the average score
    meets ``min_score`` AND no check scored 0.0.
    """
    checks = [
        _check_min_steps(session_observations),
        _check_success_evidence(session_observations),
        _check_dedup(proposed_description, existing_skills),
        _check_guard_scan(proposed_content),
        _check_actionability(proposed_content),
    ]
    avg = sum(c.score for c in checks) / len(checks) if checks else 0.0
    failed = [c for c in checks if not c.passed]
    zero_scored = [c for c in checks if c.score == 0.0]

    if zero_scored or avg < min_score:
        reasons = ", ".join(c.reason for c in failed) if failed else "score below threshold"
        return GateResult(False, reasons, round(avg, 3), checks)
    return GateResult(True, "all checks passed", round(avg, 3), checks)
