#!/usr/bin/env python3
"""Lightweight regex scan for agent-created skill content (Hermes-aligned).

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

ScanVerdict = Literal["safe", "caution", "dangerous"]


@dataclass
class ScanFinding:
    severity: ScanVerdict
    pattern_name: str
    matched_text: str
    file_path: str
    line_number: int


@dataclass
class ScanResult:
    verdict: ScanVerdict
    findings: list[ScanFinding] = field(default_factory=list)


TRUST_POLICY: dict[str, tuple[str, str, str]] = {
    "agent-created": ("allow", "allow", "block"),
    "community": ("allow", "allow", "block"),
    "builtin": ("allow", "allow", "allow"),
}

_PATTERN_DEFS: list[tuple[str, ScanVerdict, re.Pattern[str]]] = [
    # Detect curl/wget piping shell variables ($VAR or ${VAR}) into a URL —
    # the signal for credential/environment exfiltration.
    # Plain ``curl https://... -H "..."`` in API docs does NOT match.
    ("exfiltration_curl", "dangerous", re.compile(r"curl\s+.*\$\{?\w", re.IGNORECASE)),
    ("exfiltration_wget", "dangerous", re.compile(r"wget\s+.*\$\{?\w", re.IGNORECASE)),
    # fetch() calls reading process.env / os.environ — exfiltration pattern.
    ("exfiltration_fetch_env", "dangerous", re.compile(r"fetch\s*\(.*(?:process\.env|os\.environ)", re.IGNORECASE)),
    ("credential_ssh", "dangerous", re.compile(r"~/\.ssh")),
    ("credential_dotenv", "caution", re.compile(r"\.env\b")),
    ("prompt_ignore_previous", "dangerous", re.compile(r"ignore\s+previous", re.IGNORECASE)),
    ("prompt_system", "dangerous", re.compile(r"system\s+prompt", re.IGNORECASE)),
    ("prompt_system_tag", "dangerous", re.compile(r"<system>", re.IGNORECASE)),
    ("destructive_rm", "dangerous", re.compile(r"rm\s+-rf\s+/")),
    ("destructive_chmod", "dangerous", re.compile(r"chmod\s+777")),
    ("destructive_sql", "dangerous", re.compile(r"DROP\s+TABLE", re.IGNORECASE)),
]


def _verdict_rank(v: ScanVerdict) -> int:
    return {"safe": 0, "caution": 1, "dangerous": 2}[v]


def _merge_verdict(findings: list[ScanFinding]) -> ScanVerdict:
    if not findings:
        return "safe"
    best: ScanVerdict = "safe"
    for f in findings:
        if _verdict_rank(f.severity) > _verdict_rank(best):
            best = f.severity
    return best


def scan_skill(skill_dir: Path, *, source: str = "agent-created") -> ScanResult:
    """Scan ``SKILL.md`` under ``skill_dir`` (if present). Empty / missing file → safe."""
    _ = source  # reserved for trust-variant scans
    skill_dir = Path(skill_dir).expanduser().resolve(strict=False)
    path = skill_dir / "SKILL.md"
    if not path.is_file():
        return ScanResult(verdict="safe", findings=[])
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ScanResult(verdict="safe", findings=[])
    findings: list[ScanFinding] = []
    rel = str(path)
    for line_no, line in enumerate(text.splitlines(), start=1):
        for pname, severity, rx in _PATTERN_DEFS:
            m = rx.search(line)
            if m:
                findings.append(
                    ScanFinding(
                        severity=severity,
                        pattern_name=pname,
                        matched_text=m.group(0)[:200],
                        file_path=rel,
                        line_number=line_no,
                    )
                )
    return ScanResult(verdict=_merge_verdict(findings), findings=findings)


def scan_skill_markdown_text(text: str, *, source: str = "community") -> ScanResult:
    """Scan SKILL.md content from a string (writes a temp dir with SKILL.md).

    Args:
        text: Markdown body of SKILL.md.
        source: Trust label passed through to :func:`scan_skill` (reserved).

    Returns:
        Same shape as :func:`scan_skill` on a directory.
    """
    import tempfile

    _ = source
    with tempfile.TemporaryDirectory() as td:
        skill_dir = Path(td) / "_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(text, encoding="utf-8", errors="replace")
        return scan_skill(skill_dir, source=source)


def finding_to_dict(finding: ScanFinding) -> dict[str, Any]:
    """Serialize a single finding for API / UI."""
    return {
        "severity": finding.severity,
        "pattern_name": finding.pattern_name,
        "matched_text": finding.matched_text,
        "file_path": finding.file_path,
        "line_number": finding.line_number,
    }


def scan_result_to_payload(result: ScanResult, skill_name: str = "") -> dict[str, Any]:
    """Serialize scan result for API responses."""
    return {
        "skill_name": skill_name,
        "verdict": result.verdict,
        "findings": [finding_to_dict(f) for f in result.findings],
    }


def merge_verdicts(verdicts: list[ScanVerdict]) -> ScanVerdict:
    """Pick the highest severity from a list of verdicts."""
    if not verdicts:
        return "safe"
    best: ScanVerdict = "safe"
    for v in verdicts:
        if _verdict_rank(v) > _verdict_rank(best):
            best = v
    return best


def should_allow(result: ScanResult, source: str) -> tuple[bool, str]:
    policy = TRUST_POLICY.get(source, TRUST_POLICY["agent-created"])
    safe_a, caution_a, danger_a = policy
    if result.verdict == "dangerous":
        if danger_a == "block":
            return False, "blocked: dangerous patterns in skill content"
        return True, "allowed: dangerous (policy permits)"
    if result.verdict == "caution":
        if caution_a == "block":
            return False, "blocked: caution-level patterns"
        return True, "allowed: caution"
    if safe_a == "block":
        return False, "blocked: policy"
    return True, "allowed: safe"
