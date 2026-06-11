#!/usr/bin/env python3
"""Document review CLI for enterprise acceptance.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from doc_model import load_document
from findings import Finding, summarize_by_category, summarize_by_grade
from format_checks import run_format_checks


def load_rules(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rules = data.get("rules", [])
    if not isinstance(rules, list):
        raise ValueError("rules must be a list")
    return [rule for rule in rules if isinstance(rule, dict)]


def review_text(text: str, rules: list[dict[str, Any]]) -> list[Finding]:
    findings: list[Finding] = []
    for idx, rule in enumerate(rules):
        rule_id = str(rule.get("id") or f"rule-{idx+1}")
        severity = str(rule.get("severity") or "medium")
        message = str(rule.get("message") or "rule matched")
        rule_type = str(rule.get("type") or "keyword")
        grade = str(rule.get("grade") or "建议修改")
        category = str(rule.get("category") or "一类")

        if rule_type == "regex":
            pattern = str(rule.get("pattern") or "")
            if not pattern:
                continue
            for match in re.finditer(pattern, text):
                findings.append(
                    Finding(
                        rule_id=rule_id,
                        severity=severity,
                        matched=match.group(0),
                        start=match.start(),
                        end=match.end(),
                        message=message,
                        category=category,
                        grade=grade,
                    )
                )
        else:
            keyword = str(rule.get("keyword") or "")
            if not keyword:
                continue
            start = 0
            while True:
                pos = text.find(keyword, start)
                if pos < 0:
                    break
                findings.append(
                    Finding(
                        rule_id=rule_id,
                        severity=severity,
                        matched=keyword,
                        start=pos,
                        end=pos + len(keyword),
                        message=message,
                        category=category,
                        grade=grade,
                    )
                )
                start = pos + len(keyword)

    findings.sort(key=lambda item: (item.start, item.end))
    return findings


def build_payload(
    *,
    input_path: Path,
    findings: list[Finding],
    rules_file: str | None = None,
    format_check: bool = False,
) -> dict[str, Any]:
    issues = [item.to_dict() for item in findings]
    payload: dict[str, Any] = {
        "ok": True,
        "input_file": str(input_path),
        "findings_count": len(findings),
        "issues": issues,
        "findings": issues,
        "by_category": summarize_by_category(findings),
        "by_grade": summarize_by_grade(findings),
    }
    if rules_file:
        payload["rules_file"] = rules_file
    if format_check:
        payload["format_check"] = True
    return payload


def run_review(
    input_path: Path,
    *,
    rules_path: Path | None,
    format_check: bool,
) -> list[Finding]:
    suffix = input_path.suffix.lower()
    findings: list[Finding] = []

    if suffix in {".docx", ".pdf"}:
        if not format_check:
            raise ValueError(
                f"format check is required for {suffix} input; pass --format-check"
            )
        doc = load_document(input_path)
        findings.extend(run_format_checks(doc))
    else:
        text = input_path.read_text(encoding="utf-8")
        if rules_path is not None:
            findings.extend(review_text(text, load_rules(rules_path)))
        if format_check:
            raise ValueError("--format-check for .txt is unsupported; use .docx or .pdf")

    if suffix == ".txt" and rules_path is None:
        raise ValueError("--rules is required for .txt input")

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Doc review CLI")
    parser.add_argument("--input", required=True, help="Input txt/docx/pdf file")
    parser.add_argument("--rules", default="", help="Rules json file (txt input)")
    parser.add_argument("--format-check", action="store_true", help="Enable format checks")
    parser.add_argument("--output", default="", help="Output json file (optional)")
    args = parser.parse_args()

    input_path = Path(args.input)
    rules_path = Path(args.rules) if args.rules else None
    findings = run_review(
        input_path,
        rules_path=rules_path,
        format_check=args.format_check,
    )
    payload = build_payload(
        input_path=input_path,
        findings=findings,
        rules_file=str(rules_path) if rules_path else None,
        format_check=args.format_check,
    )

    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(raw, encoding="utf-8")
    print(raw)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
