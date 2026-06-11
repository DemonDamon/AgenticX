#!/usr/bin/env python3
"""Evaluate miss/false-alarm rates for doc review findings.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _normalize_category(value: str) -> str:
    if value in {"一类", "二类", "三类"}:
        return value
    return "三类"


def _finding_matches(expected: dict[str, Any], finding: dict[str, Any]) -> bool:
    category = _normalize_category(str(expected.get("category") or ""))
    if _normalize_category(str(finding.get("category") or "")) != category:
        return False
    locator = str(expected.get("locator") or "")
    if not locator:
        return False
    haystack = " ".join(
        [
            str(finding.get("matched") or ""),
            str(finding.get("message") or ""),
            str(finding.get("rule_id") or ""),
        ]
    )
    return locator in haystack


def score(expected: list[dict[str, Any]], tool_findings: list[dict[str, Any]]) -> dict[str, Any]:
    categories = ["一类", "二类"]
    results: dict[str, Any] = {}
    for category in categories:
        expected_items = [
            item
            for item in expected
            if _normalize_category(str(item.get("category") or "")) == category
        ]
        matched_expected: set[int] = set()
        matched_findings: set[int] = set()

        for exp_idx, expected_item in enumerate(expected_items):
            for finding_idx, finding in enumerate(tool_findings):
                if finding_idx in matched_findings:
                    continue
                if _finding_matches(expected_item, finding):
                    matched_expected.add(exp_idx)
                    matched_findings.add(finding_idx)
                    break

        missed = len(expected_items) - len(matched_expected)
        false_alarm = len(tool_findings) - len(matched_findings)
        category_findings = [
            item
            for item in tool_findings
            if _normalize_category(str(item.get("category") or "")) == category
        ]
        false_alarm = max(0, len(category_findings) - len(matched_findings))

        expected_count = len(expected_items)
        finding_count = len(category_findings)
        results[category] = {
            "expected_count": expected_count,
            "finding_count": finding_count,
            "matched_count": len(matched_expected),
            "missed": missed,
            "false_alarm": false_alarm,
            "miss_rate": (missed / expected_count) if expected_count else 0.0,
            "false_alarm_rate": (false_alarm / finding_count) if finding_count else 0.0,
        }
    return results


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("json root must be an object")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Doc review metrics evaluator")
    parser.add_argument("--expected", required=True, help="Expected labels json")
    parser.add_argument("--report", required=True, help="Tool report json")
    parser.add_argument("--output", default="", help="Output metrics json")
    args = parser.parse_args()

    expected_doc = load_json(Path(args.expected))
    report_doc = load_json(Path(args.report))
    expected = expected_doc.get("expected", [])
    findings = report_doc.get("findings") or report_doc.get("issues") or []
    if not isinstance(expected, list) or not isinstance(findings, list):
        raise ValueError("expected must be a list and report findings must be a list")

    metrics = {
        "ok": True,
        "expected_file": str(Path(args.expected)),
        "report_file": str(Path(args.report)),
        "categories": score(expected, findings),
    }
    raw = json.dumps(metrics, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(raw, encoding="utf-8")
    print(raw)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
