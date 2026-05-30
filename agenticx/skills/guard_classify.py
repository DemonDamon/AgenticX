#!/usr/bin/env python3
"""Skill tier classification for adaptive guard scanning.

Port of cls-certify skill-classify.sh / code-stats.sh.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from agenticx.skills.guard_types import EXECUTABLE_EXTENSIONS, SCANNABLE_EXTENSIONS

HEAVY_EXEC_LINES = 200
HEAVY_CODE_FILES = 10
HEAVY_EXEC_SIZE = 102400

EXECUTABLE_FENCE_LANGS = frozenset({
    "bash", "sh", "shell", "zsh", "python", "py", "javascript", "js", "typescript", "ts",
})

FENCE_BLOCK_RE = re.compile(
    r"```(\w+)?[^\n]*\n(.*?)```",
    re.DOTALL | re.IGNORECASE,
)


@dataclass
class CodeStats:
    total_files: int = 0
    total_lines: int = 0
    total_size_bytes: int = 0
    executable_lines: int = 0
    executable_size_bytes: int = 0
    code_file_count: int = 0
    all_md: bool = True
    has_references_dir: bool = False
    high_risk_blocks: int = 0
    medium_risk_blocks: int = 0


@dataclass
class ScanStrategy:
    tier: str
    scan_skill_md_only: bool = False
    skip_secret: bool = False
    skip_entropy: bool = False
    skip_dep: bool = False
    skip_url_full: bool = False
    md_only_categories: list[str] = field(default_factory=list)


def _risk_block_lines(code: str) -> tuple[int, int]:
    high = medium = 0
    for line in code.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if re.search(r"\b(eval|exec|system|child_process|os\.system|subprocess|curl\s+.*\|)\b", s, re.I):
            high += 1
        elif re.search(r"\b(curl|wget|fetch|requests\.|sudo|chmod)\b", s, re.I):
            medium += 1
    return high, medium


def compute_code_stats(skill_dir: Path) -> CodeStats:
    """Aggregate file and executable-line statistics for a skill directory."""
    stats = CodeStats()
    skill_dir = Path(skill_dir).expanduser().resolve(strict=False)
    if not skill_dir.is_dir():
        return stats
    stats.has_references_dir = (skill_dir / "references").is_dir()
    for f in skill_dir.rglob("*"):
        if not f.is_file():
            continue
        stats.total_files += 1
        try:
            size = f.stat().st_size
        except OSError:
            continue
        stats.total_size_bytes += size
        ext = f.suffix.lower()
        if ext != ".md":
            stats.all_md = False
        if ext in EXECUTABLE_EXTENSIONS:
            stats.code_file_count += 1
            stats.executable_size_bytes += size
        if ext not in SCANNABLE_EXTENSIONS and f.name != "SKILL.md":
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = text.splitlines()
        stats.total_lines += len(lines)
        if ext in EXECUTABLE_EXTENSIONS:
            stats.executable_lines += len([ln for ln in lines if ln.strip()])
        if ext == ".md" or f.name == "SKILL.md":
            for m in FENCE_BLOCK_RE.finditer(text):
                lang = (m.group(1) or "").lower()
                body = m.group(2) or ""
                if lang in EXECUTABLE_FENCE_LANGS or not lang:
                    h, med = _risk_block_lines(body)
                    stats.high_risk_blocks += h
                    stats.medium_risk_blocks += med
    return stats


def classify_tier(stats: CodeStats, *, scan_mode: str = "standard") -> str:
    """Return T-MD | T-LITE | T-REF | T-HEAVY."""
    if scan_mode == "quick":
        return "T-MD"
    if scan_mode == "full":
        return "T-HEAVY" if stats.code_file_count > 0 else "T-REF"
    if stats.all_md and stats.high_risk_blocks == 0 and stats.medium_risk_blocks == 0 and stats.code_file_count == 0:
        return "T-MD"
    if (
        stats.executable_lines > HEAVY_EXEC_LINES
        or stats.code_file_count > HEAVY_CODE_FILES
        or stats.executable_size_bytes > HEAVY_EXEC_SIZE
    ):
        return "T-HEAVY"
    if stats.has_references_dir or stats.high_risk_blocks > 0 or stats.medium_risk_blocks > 0:
        return "T-REF"
    return "T-LITE"


def get_scan_strategy(tier: str, *, scan_mode: str = "standard") -> ScanStrategy:
    """Map tier to scan depth flags."""
    md_only_cats = [
        "prompt_injection", "prompt_poison", "ai_safety", "agent_context", "privilege_escalation",
    ]
    if tier == "T-MD":
        return ScanStrategy(
            tier=tier,
            scan_skill_md_only=True,
            skip_secret=True,
            skip_entropy=True,
            skip_dep=True,
            skip_url_full=True,
            md_only_categories=md_only_cats,
        )
    if tier == "T-HEAVY":
        return ScanStrategy(tier=tier, md_only_categories=[])
    if tier == "T-REF":
        return ScanStrategy(tier=tier, md_only_categories=[])
    return ScanStrategy(tier=tier, md_only_categories=[])


def extract_fenced_code_blocks(text: str) -> list[tuple[str, str, int]]:
    """Return (lang, body, block_index) for executable fenced blocks in markdown."""
    blocks: list[tuple[str, str, int]] = []
    for idx, m in enumerate(FENCE_BLOCK_RE.finditer(text)):
        lang = (m.group(1) or "").lower()
        body = m.group(2) or ""
        if lang in EXECUTABLE_FENCE_LANGS or lang in {"", "text"}:
            blocks.append((lang or "text", body, idx))
    return blocks
