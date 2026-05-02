#!/usr/bin/env python3
"""Minimal doc review CLI for Hechuang acceptance."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Finding:
    rule_id: str
    severity: str
    matched: str
    start: int
    end: int
    message: str


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

        if rule_type == "regex":
            pattern = str(rule.get("pattern") or "")
            if not pattern:
                continue
            for m in re.finditer(pattern, text):
                findings.append(
                    Finding(
                        rule_id=rule_id,
                        severity=severity,
                        matched=m.group(0),
                        start=m.start(),
                        end=m.end(),
                        message=message,
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
                    )
                )
                start = pos + len(keyword)

    findings.sort(key=lambda x: (x.start, x.end))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Doc review CLI")
    parser.add_argument("--input", required=True, help="Input text file")
    parser.add_argument("--rules", required=True, help="Rules json file")
    parser.add_argument("--output", default="", help="Output json file (optional)")
    args = parser.parse_args()

    text = Path(args.input).read_text(encoding="utf-8")
    rules = load_rules(Path(args.rules))
    findings = review_text(text, rules)

    payload = {
        "ok": True,
        "input_file": str(Path(args.input)),
        "rules_file": str(Path(args.rules)),
        "findings_count": len(findings),
        "findings": [
            {
                "rule_id": f.rule_id,
                "severity": f.severity,
                "matched": f.matched,
                "start": f.start,
                "end": f.end,
                "message": f.message,
            }
            for f in findings
        ],
    }

    raw = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(raw, encoding="utf-8")
    print(raw)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
