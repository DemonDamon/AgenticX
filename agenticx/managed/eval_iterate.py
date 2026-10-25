#!/usr/bin/env python3
"""Pure functions that turn low-scoring eval cases into a system-prompt candidate.

Author: Damon Li
"""

from __future__ import annotations

import copy
import difflib
import json
from collections.abc import Mapping, Sequence
from typing import Any

from agenticx.managed.manifest import validate_manifest

MAX_FAILURES = 20
MAX_FAILURE_ANSWER_CHARS = 2000


def select_failures(results: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """status == failed, ordered by score_milli asc then position asc, first MAX_FAILURES."""
    failed = [row for row in results if row.get("status") == "failed"]
    failed.sort(key=lambda row: (int(row.get("score_milli") or 0), int(row.get("position") or 0)))
    return failed[:MAX_FAILURES]


def _failed_checks(row: Mapping[str, Any]) -> str:
    rules = row.get("rule_results") or []
    bits: list[str] = []
    if isinstance(rules, list):
        for rule in rules:
            if isinstance(rule, dict) and rule.get("passed") is False:
                bits.append(f"{rule.get('type')}: {rule.get('detail')}")
    return ", ".join(bits) if bits else "(none)"


def build_iteration_prompt(
    *,
    system: str,
    criteria: str,
    failures: Sequence[Mapping[str, Any]],
) -> str:
    """Prompt the optimizer. The template is fixed so the model returns JSON only."""
    criteria_text = criteria if criteria else "(rule checks only)"
    lines = [
        "You improve the system prompt of an AI agent. Keep everything that already works.",
        "Change only what is needed to fix the failures below. Do not invent tools or data sources.",
        'Return ONLY JSON: {"system": "<full new system prompt>", "rationale": "<what you changed and why, under 800 characters>"}',
        "",
        "## Evaluation criteria",
        criteria_text,
        "",
        "## Current system prompt",
        system,
        "",
        "## Failed cases",
    ]
    for index, failure in enumerate(failures, start=1):
        judge = failure.get("judge")
        reason = judge.get("reason") if isinstance(judge, dict) else None
        judge_text = str(reason) if reason else "(none)"
        query = str(failure.get("query") or "")[:2000]
        answer = str(failure.get("answer") or "")[:MAX_FAILURE_ANSWER_CHARS]
        lines.extend(
            [
                f"### Case {index}",
                f"Query: {query}",
                f"Answer: {answer}",
                f"Judge: {judge_text}",
                f"Failed checks: {_failed_checks(failure)}",
            ]
        )
    return "\n".join(lines)


def parse_iteration_response(text: str) -> tuple[str, str] | None:
    """Return (system, rationale). Accept raw JSON or the first {...} block."""
    raw = text.strip()
    if not raw:
        return None
    parsed: Any
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            parsed = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(parsed, dict):
        return None
    system = parsed.get("system")
    rationale = parsed.get("rationale", "")
    if not isinstance(system, str) or not isinstance(rationale, str):
        return None
    return system, rationale


def build_candidate(base_manifest: Mapping[str, Any], new_system: str) -> dict[str, Any]:
    """Copy the manifest, replace system, and return hash plus a unified diff.

    Raises ValueError("optimizer produced no change") when the system text is unchanged,
    ValueError("candidate manifest invalid: <first error>") when validate_manifest fails.
    """
    old = str(base_manifest.get("system") or "")
    if new_system == old:
        raise ValueError("optimizer produced no change")
    manifest = copy.deepcopy(dict(base_manifest))
    manifest["system"] = new_system
    result = validate_manifest(manifest)
    if not result.ok or result.normalized is None or result.manifest_hash is None:
        first = result.errors[0] if result.errors else "invalid"
        raise ValueError(f"candidate manifest invalid: {first}")
    diff = "\n".join(
        difflib.unified_diff(
            old.splitlines(),
            new_system.splitlines(),
            fromfile="current",
            tofile="candidate",
            lineterm="",
        )
    )
    return {
        "manifest": result.normalized,
        "manifest_hash": result.manifest_hash,
        "diff": {"system": diff},
    }


__all__ = [
    "MAX_FAILURES",
    "MAX_FAILURE_ANSWER_CHARS",
    "build_candidate",
    "build_iteration_prompt",
    "parse_iteration_response",
    "select_failures",
]
