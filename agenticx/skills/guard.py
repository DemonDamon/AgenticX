#!/usr/bin/env python3
"""Security scanner for skill content — regex-based static analysis.

Scans SKILL.md (and supporting files) for known-bad patterns:
exfiltration, prompt injection, destructive operations, persistence,
network threats, obfuscation, supply chain risks, privilege escalation,
credential exposure, and structural anomalies.

Trust levels control the install policy matrix:
  builtin  — ships with AgenticX, always allowed
  trusted  — curated registries, caution findings allowed
  community — everything else, any finding may block
  agent-created — written by the agent itself, dangerous = block

v2 (``skills.guard.version: 2``): YAML pattern library, tier classification,
entropy/URL/dep checks, score/grade — see ``guard_engine.py``.

Upstream reference: hermes-agent ``tools/skills_guard.py`` (MIT, Nous Research);
cls-certify pattern port (MIT, CatREFuse/CocoLoop).

Author: Damon Li
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

from agenticx.skills.guard_config import GuardConfig, load_guard_config
from agenticx.skills.guard_engine import (
    scan_markdown_with_fenced_blocks,
    scan_skill_v2,
    verify_findings_with_llm,
)
from agenticx.skills.guard_report import render_html_report, write_html_report
from agenticx.skills.guard_types import (
    TRUST_POLICY,
    ScanFinding,
    ScanResult,
    ScanVerdict,
    finding_to_dict,
    merge_verdict,
    verdict_rank,
)
from agenticx.skills.guard_v1 import scan_skill_v1

logger = logging.getLogger("agenticx.skills")

# Re-export for backward compatibility
__all__ = [
    "ScanVerdict",
    "ScanFinding",
    "ScanResult",
    "TRUST_POLICY",
    "scan_skill",
    "scan_skill_markdown_text",
    "scan_skill_deep",
    "scan_result_to_payload",
    "should_allow",
    "merge_verdicts",
    "resolve_trust_level",
    "finding_to_dict",
    "render_html_report",
    "write_html_report",
    "load_guard_config",
]


def _use_v2(config: GuardConfig | None = None) -> bool:
    cfg = config or load_guard_config()
    return cfg.version >= 2


def scan_skill(skill_dir: Path, *, source: str = "agent-created") -> ScanResult:
    """Scan all text files in a skill directory for security threats."""
    cfg = load_guard_config()
    if _use_v2(cfg):
        return scan_skill_v2(skill_dir, source=source, config=cfg)
    return scan_skill_v1(skill_dir, source=source)


def scan_skill_markdown_text(text: str, *, source: str = "community") -> ScanResult:
    """Scan SKILL.md content from a string."""
    cfg = load_guard_config()
    if _use_v2(cfg):
        return scan_markdown_with_fenced_blocks(text, source=source, config=cfg)
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        skill_dir = Path(td) / "_skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(text, encoding="utf-8", errors="replace")
        return scan_skill(skill_dir, source=source)


def scan_skill_deep(
    skill_dir: Path,
    *,
    source: str = "community",
    mode: Literal["quick", "standard", "full"] = "standard",
    verify_with_llm: bool = False,
) -> ScanResult:
    """Full-depth scan for audit UI / CLI."""
    cfg = load_guard_config()
    cfg = GuardConfig(
        version=max(2, cfg.version),
        scan_mode=mode,
        llm_verify=verify_with_llm or cfg.llm_verify,
        scan_timeout_seconds=cfg.scan_timeout_seconds,
    )
    result = scan_skill_v2(skill_dir, source=source, config=cfg, deep=True)
    if cfg.llm_verify and result.findings:
        import asyncio

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                filtered = result.findings
            else:
                filtered = loop.run_until_complete(verify_findings_with_llm(result.findings))
        except RuntimeError:
            filtered = asyncio.run(verify_findings_with_llm(result.findings))
        result = ScanResult(
            verdict=merge_verdict(filtered),
            findings=filtered,
            source=result.source,
            score=result.score,
            grade=result.grade,
            tier=result.tier,
            pattern_set_version=result.pattern_set_version,
        )
    return result


def scan_result_to_payload(result: ScanResult, skill_name: str = "") -> dict[str, Any]:
    """Serialize scan result for API responses."""
    payload: dict[str, Any] = {
        "skill_name": skill_name,
        "verdict": result.verdict,
        "findings": [finding_to_dict(f) for f in result.findings],
    }
    if result.score is not None:
        payload["score"] = result.score
    if result.grade:
        payload["grade"] = result.grade
    if result.tier:
        payload["tier"] = result.tier
    if result.pattern_set_version:
        payload["pattern_set_version"] = result.pattern_set_version
    return payload


def merge_verdicts(verdicts: list[ScanVerdict]) -> ScanVerdict:
    """Pick the highest severity from a list of verdicts."""
    if not verdicts:
        return "safe"
    best: ScanVerdict = "safe"
    for v in verdicts:
        if verdict_rank(v) > verdict_rank(best):
            best = v
    return best


def resolve_trust_level(source: str) -> str:
    """Map a source string to a trust level key for policy lookup."""
    if source in TRUST_POLICY:
        return source
    if source.startswith("official"):
        return "builtin"
    return "community"


def should_allow(result: ScanResult, source: str | None = None) -> tuple[bool, str]:
    """Determine whether a skill should be installed given its scan result."""
    effective_source = source or result.source or "agent-created"
    trust = resolve_trust_level(effective_source)
    policy = TRUST_POLICY.get(trust, TRUST_POLICY["community"])
    safe_a, caution_a, danger_a = policy
    n = len(result.findings)
    if result.verdict == "dangerous":
        if danger_a == "block":
            return False, f"blocked: dangerous ({trust} source, {n} findings)"
        return True, f"allowed: dangerous ({trust} permits)"
    if result.verdict == "caution":
        if caution_a == "block":
            return False, f"blocked: caution ({trust} source, {n} findings)"
        return True, f"allowed: caution ({trust})"
    if safe_a == "block":
        return False, f"blocked: policy ({trust})"
    return True, f"allowed: safe ({trust})"
