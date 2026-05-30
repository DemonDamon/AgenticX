#!/usr/bin/env python3
"""Skill guard scoring — 0-100 score and S+~D letter grades.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.skills.guard_types import ScanFinding, ScanVerdict

FORCE_D_PATTERNS = frozenset({
    "prompt_ignore_previous", "prompt_system", "prompt_system_tag", "role_hijack",
    "deception_hide", "disregard_rules", "jailbreak_dan", "jailbreak_dev_mode",
    "reverse_shell", "bash_reverse_shell", "curl_pipe_shell", "wget_pipe_shell",
    "dynamic_download_l2", "dynamic_download_l3", "invisible_unicode",
    "TH-PP-001", "TH-PP-002", "TH-PP-003",
})

CAP_C_PATTERNS = frozenset({
    "tunnel_service", "exfil_service", "suspicious_url", "typosquat_dependency",
})

SEVERITY_DEDUCTION: dict[ScanVerdict, int] = {
    "dangerous": 25,
    "caution": 10,
    "safe": 0,
}


def score_to_grade(score: int) -> str:
    if score >= 90:
        return "S+"
    if score >= 80:
        return "S"
    if score >= 65:
        return "A"
    if score >= 50:
        return "B"
    if score >= 30:
        return "C"
    return "D"


def compute_score_and_grade(findings: list[ScanFinding]) -> tuple[int, str]:
    """Compute numeric score and letter grade from findings."""
    if not findings:
        return 100, "S+"
    base = 100
    force_d = False
    cap_c = False
    for f in findings:
        pname = f.pattern_name
        if pname in FORCE_D_PATTERNS or f.category in {"prompt_poison", "prompt_injection"} and f.severity == "dangerous":
            if f.severity == "dangerous":
                force_d = True
        if pname in CAP_C_PATTERNS:
            cap_c = True
        base -= SEVERITY_DEDUCTION.get(f.severity, 5)
    score = max(0, min(100, base))
    if force_d:
        score = min(score, 29)
    elif cap_c:
        score = min(score, 49)
    return score, score_to_grade(score)
