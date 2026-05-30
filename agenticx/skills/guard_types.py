#!/usr/bin/env python3
"""Shared types and constants for skill guard v1/v2.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ScanVerdict = Literal["safe", "caution", "dangerous"]

SCANNABLE_EXTENSIONS: frozenset[str] = frozenset({
    ".md", ".txt", ".py", ".sh", ".bash", ".js", ".ts", ".rb",
    ".yaml", ".yml", ".json", ".toml", ".cfg", ".ini", ".conf",
    ".html", ".css", ".xml",
})

EXECUTABLE_EXTENSIONS: frozenset[str] = frozenset({
    ".py", ".sh", ".bash", ".js", ".ts", ".rb",
})

SUSPICIOUS_BINARY_EXTENSIONS: frozenset[str] = frozenset({
    ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".com",
    ".msi", ".dmg", ".app", ".deb", ".rpm",
})

MAX_FILE_COUNT = 50
MAX_TOTAL_SIZE_KB = 1024
MAX_SINGLE_FILE_KB = 256
MAX_SCAN_LINES_PER_FILE = 8000

TRUST_POLICY: dict[str, tuple[str, str, str]] = {
    "builtin": ("allow", "allow", "allow"),
    "trusted": ("allow", "allow", "block"),
    "community": ("allow", "block", "block"),
    "agent-created": ("allow", "allow", "block"),
}


@dataclass
class ScanFinding:
    severity: ScanVerdict
    pattern_name: str
    matched_text: str
    file_path: str
    line_number: int
    category: str = ""
    pattern_id: str = ""


@dataclass
class ScanResult:
    verdict: ScanVerdict
    findings: list[ScanFinding] = field(default_factory=list)
    source: str = ""
    score: int | None = None
    grade: str | None = None
    tier: str | None = None
    pattern_set_version: str = ""


def verdict_rank(v: ScanVerdict) -> int:
    return {"safe": 0, "caution": 1, "dangerous": 2}[v]


def merge_verdict(findings: list[ScanFinding]) -> ScanVerdict:
    if not findings:
        return "safe"
    best: ScanVerdict = "safe"
    for f in findings:
        if verdict_rank(f.severity) > verdict_rank(best):
            best = f.severity
    return best


def finding_to_dict(finding: ScanFinding) -> dict[str, Any]:
    out: dict[str, Any] = {
        "severity": finding.severity,
        "pattern_name": finding.pattern_name,
        "matched_text": finding.matched_text,
        "file_path": finding.file_path,
        "line_number": finding.line_number,
    }
    if finding.category:
        out["category"] = finding.category
    if finding.pattern_id:
        out["pattern_id"] = finding.pattern_id
    return out
