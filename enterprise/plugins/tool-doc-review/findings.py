#!/usr/bin/env python3
"""Shared finding types for document review.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass
class Finding:
    rule_id: str
    severity: str
    matched: str
    start: int
    end: int
    message: str
    category: str = "一类"
    grade: str = "建议修改"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def summarize_by_category(findings: list[Finding]) -> dict[str, int]:
    counts: dict[str, int] = {"一类": 0, "二类": 0, "三类": 0}
    for item in findings:
        key = item.category if item.category in counts else "三类"
        counts[key] = counts.get(key, 0) + 1
    return counts


def summarize_by_grade(findings: list[Finding]) -> dict[str, int]:
    counts: dict[str, int] = {
        "严重错误": 0,
        "建议修改": 0,
        "排版建议": 0,
    }
    for item in findings:
        key = item.grade if item.grade in counts else "建议修改"
        counts[key] = counts.get(key, 0) + 1
    return counts
