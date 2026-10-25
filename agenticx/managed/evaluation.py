#!/usr/bin/env python3
"""Rubric validation, rule checks, and gateway-backed judging for managed evals.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from agenticx.evaluation.llm_judge import JudgeMode, LLMJudge
from agenticx.managed.manifest import MODEL_RE, canonical_json

RULE_TYPES = (
    "contains",
    "not_contains",
    "regex",
    "tool_called",
    "tool_not_called",
    "max_tool_calls",
    "stop_reason",
)
JUDGE_MODES = ("binary", "score")
STOP_REASON_VALUES = (
    "end_turn",
    "requires_action",
    "retries_exhausted",
    "refusal",
    "max_tool_rounds",
    "budget_exceeded",
    "policy_blocked",
)
MAX_CRITERIA_BYTES = 32768
MAX_RULE_CHECKS = 20
MAX_RULE_VALUE_BYTES = 1000
MAX_RULE_PATTERN_BYTES = 500
DEFAULT_PASS_THRESHOLD = 0.7
_RULE_TYPE_LIST = "[" + ",".join(RULE_TYPES) + "]"
_STOP_LIST = "[" + ",".join(STOP_REASON_VALUES) + "]"
_ALLOWED_KEYS = {"criteria", "mode", "pass_threshold", "judge_model", "rule_checks"}
_RULE_FIELDS = {
    "contains": {"type", "value", "case_sensitive"},
    "not_contains": {"type", "value", "case_sensitive"},
    "regex": {"type", "pattern"},
    "tool_called": {"type", "name"},
    "tool_not_called": {"type", "name"},
    "max_tool_calls": {"type", "value"},
    "stop_reason": {"type", "value"},
}


@dataclass
class RubricResult:
    ok: bool
    errors: list[str]
    normalized: dict[str, Any] | None
    content_hash: str | None


@dataclass(frozen=True)
class ItemOutcome:
    answer: str
    tool_names: tuple[str, ...]
    stop_reason: str | None
    error: str | None


@dataclass(frozen=True)
class RuleResult:
    type: str
    passed: bool
    detail: str


def _failure(errors: list[str]) -> RubricResult:
    return RubricResult(ok=False, errors=sorted(errors), normalized=None, content_hash=None)


def _json_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _utf8_len(value: str) -> int:
    return len(value.encode("utf-8"))


def _content_hash(normalized: dict[str, Any]) -> str:
    digest = hashlib.sha256(canonical_json(normalized).encode("utf-8")).hexdigest()
    return "sha256:" + digest


def _check_rule(index: int, item: Any, errors: list[str]) -> dict[str, Any] | None:
    prefix = f"rubric.rule_checks[{index}]"
    if not isinstance(item, dict):
        errors.append(f"{prefix}: must be an object")
        return None
    raw_type = item.get("type")
    if raw_type not in RULE_TYPES:
        errors.append(
            f"{prefix}.type: must be one of {_RULE_TYPE_LIST}, got {_json_literal(raw_type)}"
        )
        return None
    rule_type = str(raw_type)
    allowed = _RULE_FIELDS[rule_type]
    for key in item:
        if key not in allowed:
            errors.append(f"{prefix}.{key}: unknown field")
    if rule_type in {"contains", "not_contains"}:
        value = item.get("value")
        if not isinstance(value, str) or value == "" or _utf8_len(value) > MAX_RULE_VALUE_BYTES:
            errors.append(
                f"{prefix}.value: must be a non-empty string of at most {MAX_RULE_VALUE_BYTES} bytes"
            )
            return None
        case_sensitive = item.get("case_sensitive", False)
        if "case_sensitive" in item and not isinstance(item.get("case_sensitive"), bool):
            errors.append(f"{prefix}.case_sensitive: must be a boolean")
            return None
        return {"type": rule_type, "value": value, "case_sensitive": bool(case_sensitive)}
    if rule_type == "regex":
        pattern = item.get("pattern")
        if (
            not isinstance(pattern, str)
            or pattern == ""
            or _utf8_len(pattern) > MAX_RULE_PATTERN_BYTES
        ):
            errors.append(
                f"{prefix}.pattern: must be a non-empty string of at most {MAX_RULE_PATTERN_BYTES} bytes"
            )
            return None
        return {"type": rule_type, "pattern": pattern}
    if rule_type in {"tool_called", "tool_not_called"}:
        name = item.get("name")
        if not isinstance(name, str) or name == "":
            errors.append(f"{prefix}.name: is required")
            return None
        return {"type": rule_type, "name": name}
    if rule_type == "max_tool_calls":
        value = item.get("value")
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 1000:
            errors.append(f"{prefix}.value: must be an integer between 0 and 1000")
            return None
        return {"type": rule_type, "value": value}
    value = item.get("value")
    if value not in STOP_REASON_VALUES:
        errors.append(f"{prefix}.value: must be one of {_STOP_LIST}")
        return None
    return {"type": rule_type, "value": value}


def validate_rubric(raw: Any) -> RubricResult:
    """Validate and normalize a rubric. Errors are sorted. Hash uses canonical JSON."""
    if not isinstance(raw, dict):
        return _failure(["rubric: must be a JSON object"])
    errors: list[str] = []
    for key in raw:
        if key not in _ALLOWED_KEYS:
            errors.append(f"rubric.{key}: unknown field")

    criteria_ok = True
    criteria = ""
    if "criteria" in raw:
        if not isinstance(raw["criteria"], str):
            errors.append("rubric.criteria: must be a string")
            criteria_ok = False
        else:
            criteria = raw["criteria"]
            if _utf8_len(criteria) > MAX_CRITERIA_BYTES:
                errors.append(f"rubric.criteria: exceeds {MAX_CRITERIA_BYTES} bytes")

    mode = "binary"
    if "mode" in raw:
        if raw["mode"] not in JUDGE_MODES:
            errors.append("rubric.mode: must be one of [binary,score]")
        else:
            mode = str(raw["mode"])

    pass_threshold: int | float = DEFAULT_PASS_THRESHOLD
    if "pass_threshold" in raw:
        value = raw["pass_threshold"]
        if not _is_number(value) or value < 0 or value > 1:
            errors.append("rubric.pass_threshold: must be a number between 0 and 1")
        else:
            pass_threshold = value

    judge_model: str | None = None
    if "judge_model" in raw and raw["judge_model"] is not None:
        model = raw["judge_model"]
        if not isinstance(model, str) or MODEL_RE.fullmatch(model) is None:
            errors.append('rubric.judge_model: must be null or "<providerId>/<modelName>"')
        else:
            judge_model = model
            if criteria_ok and criteria == "":
                errors.append("rubric.criteria: is required when judge_model is set")

    normalized_rules: list[dict[str, Any]] = []
    if "rule_checks" in raw:
        checks = raw["rule_checks"]
        if not isinstance(checks, list):
            errors.append("rubric.rule_checks: must be an array")
        elif len(checks) > MAX_RULE_CHECKS:
            errors.append(f"rubric.rule_checks: must contain at most {MAX_RULE_CHECKS} items")
        else:
            for index, item in enumerate(checks):
                normalized = _check_rule(index, item, errors)
                if normalized is not None:
                    normalized_rules.append(normalized)
    if not errors and judge_model is None and not normalized_rules:
        errors.append("rubric: must define judge_model or at least one rule check")
    if errors:
        return _failure(errors)
    normalized = {
        "criteria": criteria,
        "mode": mode,
        "pass_threshold": pass_threshold,
        "judge_model": judge_model,
        "rule_checks": normalized_rules,
    }
    return RubricResult(
        ok=True,
        errors=[],
        normalized=normalized,
        content_hash=_content_hash(normalized),
    )


def _fold(text: str, case_sensitive: bool) -> str:
    return text if case_sensitive else text.casefold()


def _subsequence(expected: Sequence[str], actual: Sequence[str]) -> tuple[bool, str]:
    index = 0
    for name in actual:
        if index < len(expected) and name == expected[index]:
            index += 1
    if index == len(expected):
        return True, "matched"
    return False, f"missing {expected[index]}"


def run_rule_checks(
    rule_checks: Sequence[Mapping[str, Any]],
    outcome: ItemOutcome,
    expected_tool_trace: Sequence[str] | None,
) -> list[RuleResult]:
    """Apply rubric rules, then an optional ordered tool-name subsequence check."""
    results: list[RuleResult] = []
    answer = outcome.answer or ""
    names = outcome.tool_names
    for rule in rule_checks:
        rule_type = str(rule.get("type") or "")
        if rule_type in {"contains", "not_contains"}:
            needle = str(rule.get("value") or "")
            case_sensitive = bool(rule.get("case_sensitive"))
            found = _fold(needle, case_sensitive) in _fold(answer, case_sensitive)
            passed = found if rule_type == "contains" else not found
            results.append(RuleResult(rule_type, passed, "found" if found else "not found"))
            continue
        if rule_type == "regex":
            pattern = str(rule.get("pattern") or "")
            try:
                matched = re.search(pattern, answer[:200000]) is not None
            except re.error:
                results.append(RuleResult(rule_type, False, "invalid regex"))
                continue
            results.append(RuleResult(rule_type, matched, "matched" if matched else "not matched"))
            continue
        if rule_type == "tool_called":
            found = str(rule.get("name") or "") in names
            results.append(RuleResult(rule_type, found, "found" if found else "not found"))
            continue
        if rule_type == "tool_not_called":
            found = str(rule.get("name") or "") in names
            results.append(RuleResult(rule_type, not found, "found" if found else "not found"))
            continue
        if rule_type == "max_tool_calls":
            limit = int(rule.get("value") or 0)
            passed = len(names) <= limit
            results.append(RuleResult(rule_type, passed, f"{len(names)} calls"))
            continue
        if rule_type == "stop_reason":
            passed = outcome.stop_reason == rule.get("value")
            results.append(RuleResult(rule_type, passed, str(outcome.stop_reason)))
    if expected_tool_trace:
        passed, detail = _subsequence(list(expected_tool_trace), names)
        results.append(RuleResult("expected_tool_trace", passed, detail))
    return results


class GatewayJudgeProvider:
    """agenticx.evaluation LLMProvider over a managed LLM object (has .invoke(messages))."""

    def __init__(self, llm: Any) -> None:
        self._llm = llm

    async def acomplete(self, prompt: str) -> str:
        response = await asyncio.to_thread(
            self._llm.invoke,
            [{"role": "user", "content": prompt}],
        )
        return str(getattr(response, "content", "") or "")

    def complete(self, prompt: str) -> str:
        response = self._llm.invoke([{"role": "user", "content": prompt}])
        return str(getattr(response, "content", "") or "")


def _clamp(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


async def judge_item(
    rubric: Mapping[str, Any],
    *,
    query: str,
    answer: str,
    expected_answer: str | None,
    provider: Any,
) -> dict[str, Any]:
    """Return {"score", "passed", "reason", "error"}. Caller skips this when judge_model is null."""
    mode_name = str(rubric.get("mode") or "binary")
    judge = LLMJudge(
        rubric=str(rubric.get("criteria") or ""),
        mode=JudgeMode.BINARY if mode_name == "binary" else JudgeMode.CONTINUOUS,
        llm_provider=provider,
        include_input=True,
        include_expected=expected_answer is not None,
        retry_count=1,
    )
    result = await judge.evaluate(
        output=answer,
        expected=expected_answer,
        inputs={"query": query},
    )
    metadata = result.metadata or {}
    if metadata.get("error") or metadata.get("parse_error"):
        return {
            "score": 0.0,
            "passed": False,
            "reason": result.reason,
            "error": "judge_failed",
        }
    threshold = rubric.get("pass_threshold", DEFAULT_PASS_THRESHOLD)
    if mode_name == "binary":
        passed = result.value is True
        score = 1.0 if passed else 0.0
    else:
        score = _clamp(float(result.value))
        passed = score >= float(threshold)
    return {"score": score, "passed": passed, "reason": result.reason, "error": None}


def score_item(
    rubric: Mapping[str, Any],
    rules: Sequence[RuleResult],
    judge: Mapping[str, Any] | None,
) -> tuple[Literal["passed", "failed"], float]:
    """Rules fail the item even when the judge passes. Score prefers the judge."""
    del rubric
    status: Literal["passed", "failed"] = "passed"
    if any(not rule.passed for rule in rules):
        status = "failed"
    elif judge is not None and not bool(judge.get("passed")):
        status = "failed"
    if judge is not None:
        score = float(judge.get("score") or 0.0)
    elif not rules:
        score = 1.0
    else:
        score = sum(1 for rule in rules if rule.passed) / len(rules)
    return status, score


def summarize(results: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Pass rate and mean score ignore execution errors. Rates use 4 decimal places."""
    total = len(results)
    passed = sum(1 for row in results if row.get("status") == "passed")
    failed = sum(1 for row in results if row.get("status") == "failed")
    errored = sum(1 for row in results if row.get("status") == "error")
    denom = passed + failed
    pass_rate = None if denom == 0 else round(passed / denom, 4)
    scores = [
        int(row["score_milli"])
        for row in results
        if row.get("status") != "error" and row.get("score_milli") is not None
    ]
    mean_score = None if not scores else round((sum(scores) / len(scores)) / 1000, 4)
    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "errored": errored,
        "pass_rate": pass_rate,
        "mean_score": mean_score,
    }


__all__ = [
    "DEFAULT_PASS_THRESHOLD",
    "JUDGE_MODES",
    "MAX_CRITERIA_BYTES",
    "MAX_RULE_CHECKS",
    "MAX_RULE_PATTERN_BYTES",
    "MAX_RULE_VALUE_BYTES",
    "RULE_TYPES",
    "STOP_REASON_VALUES",
    "GatewayJudgeProvider",
    "ItemOutcome",
    "RubricResult",
    "RuleResult",
    "judge_item",
    "run_rule_checks",
    "score_item",
    "summarize",
    "validate_rubric",
]
