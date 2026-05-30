#!/usr/bin/env python3
"""Skill guard v2 engine — YAML patterns, tier scan, entropy, URL, deps.

Author: Damon Li
"""

from __future__ import annotations

import fnmatch
import logging
import math
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from agenticx.skills.guard_classify import (
    ScanStrategy,
    classify_tier,
    compute_code_stats,
    extract_fenced_code_blocks,
    get_scan_strategy,
)
from agenticx.skills.guard_config import GuardConfig, load_guard_config
from agenticx.skills.guard_score import compute_score_and_grade
from agenticx.skills.guard_types import (
    MAX_SCAN_LINES_PER_FILE,
    SCANNABLE_EXTENSIONS,
    ScanFinding,
    ScanResult,
    ScanVerdict,
    merge_verdict,
)
from agenticx.skills.guard_v1 import _check_structure

logger = logging.getLogger("agenticx.skills")

PATTERNS_PATH = Path(__file__).resolve().parent / "guard_patterns.yaml"

_INVISIBLE_CHARS: frozenset[str] = frozenset({
    "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u202e",
})

FALSE_POSITIVE_WORDS = re.compile(
    r"example|sample|placeholder|your_key_here|TODO|FIXME|lorem|ipsum|fake|mock|dummy|changeme",
    re.I,
)
DOC_CONTEXT = re.compile(r"\b(scan|detect|check|检测|模式|pattern)\b", re.I)
INLINE_CODE = re.compile(r"`[^`]+`")

ENTROPY_THRESHOLD = 4.5
ENTROPY_MIN_LEN = 20
ENTROPY_TOKEN = re.compile(r"[A-Za-z0-9+/=_\-]{20,}")

SUSPICIOUS_URL = re.compile(
    r"https?://(?:[\w.-]*\.)?(webhook\.site|requestbin\.com|pipedream\.net|hookbin\.com|bit\.ly|t\.co|tinyurl\.com)[^\s\"')]*",
    re.I,
)
RAW_IP_URL = re.compile(r"https?://(?:\d{1,3}\.){3}\d{1,3}[^\s\"')]*")

KNOWN_NPM = frozenset(
    "lodash express react vue angular axios webpack babel eslint prettier typescript jest".split()
)
KNOWN_PIP = frozenset(
    "requests flask django numpy pandas scipy matplotlib fastapi uvicorn pytest".split()
)
SUSPICIOUS_PKG_KEYWORDS = re.compile(r"(hack|exploit|malicious|backdoor)", re.I)

DYNAMIC_L2 = re.compile(
    r"curl[^\n]*\|[^\n]*(bash|sh|python|node)[^\n]*curl|wget[^\n]*curl",
    re.I,
)


@dataclass
class CompiledPattern:
    pattern_id: str
    pattern_name: str
    category: str
    severity: ScanVerdict
    regex: re.Pattern[str]
    description: str = ""


@dataclass
class PatternSet:
    version: str
    pattern_set_version: str
    patterns: list[CompiledPattern]
    exclude_globs: list[str]
    md_only_categories: list[str]


@lru_cache(maxsize=1)
def load_pattern_set() -> PatternSet:
    raw = yaml.safe_load(PATTERNS_PATH.read_text(encoding="utf-8")) or {}
    compiled: list[CompiledPattern] = []
    for p in raw.get("patterns") or []:
        try:
            sev = str(p.get("severity") or "caution")
            if sev not in {"safe", "caution", "dangerous"}:
                sev = "caution"
            compiled.append(
                CompiledPattern(
                    pattern_id=str(p.get("pattern_id") or ""),
                    pattern_name=str(p.get("pattern_name") or ""),
                    category=str(p.get("category") or ""),
                    severity=sev,  # type: ignore[arg-type]
                    regex=re.compile(str(p.get("regex") or "")),
                    description=str(p.get("description") or ""),
                )
            )
        except re.error:
            continue
    return PatternSet(
        version=str(raw.get("version") or "2.0.0"),
        pattern_set_version=str(raw.get("pattern_set_version") or "unknown"),
        patterns=compiled,
        exclude_globs=[str(g) for g in raw.get("exclude_path_globs") or []],
        md_only_categories=[str(c) for c in raw.get("md_only_categories") or []],
    )


def _path_excluded(rel_path: str, globs: list[str]) -> bool:
    norm = rel_path.replace("\\", "/")
    for g in globs:
        if fnmatch.fnmatch(norm, g) or fnmatch.fnmatch(f"**/{norm}", g):
            return True
        if g.startswith("**/") and fnmatch.fnmatch(norm, g[3:]):
            return True
    return False


def _is_false_positive(line: str, matched: str, pattern_name: str) -> bool:
    high_conf = {
        "github_token", "openai_key", "openai_api_key", "aws_access_key",
        "embedded_private_key", "hardcoded_secret", "private_key",
    }
    if pattern_name not in high_conf:
        if re.search(r"\b(do not|don't|never|avoid|禁止|不要)\b.*\bsudo\b", line, re.I):
            return True
        if re.search(r"\bsudo\b.*\b(do not|don't|never|avoid|禁止|不要)\b", line, re.I):
            return True
        if "`" in line and matched in line:
            for part in INLINE_CODE.findall(line):
                if matched in part:
                    return True
        if DOC_CONTEXT.search(line):
            return True
        if re.match(r"^\s*[-*]\s+", line) and (
            DOC_CONTEXT.search(line) or "eval" in line or "exec" in line
        ):
            return True
        if re.match(r"^\s*(#|//|--)\s*", line):
            return True
    if FALSE_POSITIVE_WORDS.search(matched) or FALSE_POSITIVE_WORDS.search(line):
        return True
    return False


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    length = len(s)
    return -sum((c / length) * math.log2(c / length) for c in freq.values())


def _scan_text_v2(
    text: str,
    rel_path: str,
    patterns: list[CompiledPattern],
    *,
    category_filter: set[str] | None = None,
    apply_fp_filter: bool = True,
) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    seen: set[tuple[str, int]] = set()
    lines = text.splitlines()[:MAX_SCAN_LINES_PER_FILE]
    for line_no, line in enumerate(lines, start=1):
        for pat in patterns:
            if category_filter is not None and pat.category not in category_filter:
                continue
            key = (pat.pattern_name, line_no)
            if key in seen:
                continue
            m = pat.regex.search(line)
            if not m:
                continue
            matched = m.group(0)[:200]
            sev = pat.severity
            if apply_fp_filter and _is_false_positive(line, matched, pat.pattern_name):
                continue
            seen.add(key)
            findings.append(
                ScanFinding(
                    severity=sev,
                    pattern_name=pat.pattern_name,
                    matched_text=matched,
                    file_path=rel_path,
                    line_number=line_no,
                    category=pat.category,
                    pattern_id=pat.pattern_id,
                )
            )
        for char in _INVISIBLE_CHARS:
            if char in line:
                findings.append(
                    ScanFinding(
                        severity="dangerous",
                        pattern_name="invisible_unicode",
                        matched_text=f"U+{ord(char):04X}",
                        file_path=rel_path,
                        line_number=line_no,
                        category="prompt_poison",
                        pattern_id="INV-001",
                    )
                )
                break
    return findings


def _scan_entropy(text: str, rel_path: str) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    for line_no, line in enumerate(text.splitlines()[:MAX_SCAN_LINES_PER_FILE], start=1):
        for token in ENTROPY_TOKEN.findall(line):
            if len(token) < ENTROPY_MIN_LEN:
                continue
            if FALSE_POSITIVE_WORDS.search(token):
                continue
            if shannon_entropy(token) >= ENTROPY_THRESHOLD:
                findings.append(
                    ScanFinding(
                        severity="caution",
                        pattern_name="high_entropy_secret",
                        matched_text=token[:40] + "...",
                        file_path=rel_path,
                        line_number=line_no,
                        category="secret",
                        pattern_id="ENT-001",
                    )
                )
                break
    return findings


def _scan_urls(text: str, rel_path: str) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    for line_no, line in enumerate(text.splitlines()[:MAX_SCAN_LINES_PER_FILE], start=1):
        for rx, pname in ((SUSPICIOUS_URL, "suspicious_url"), (RAW_IP_URL, "raw_ip_url")):
            m = rx.search(line)
            if m:
                findings.append(
                    ScanFinding(
                        severity="caution",
                        pattern_name=pname,
                        matched_text=m.group(0)[:200],
                        file_path=rel_path,
                        line_number=line_no,
                        category="exfiltration",
                        pattern_id="URL-001",
                    )
                )
    return findings


def _scan_dynamic_nesting(text: str, rel_path: str) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    for line_no, line in enumerate(text.splitlines()[:MAX_SCAN_LINES_PER_FILE], start=1):
        if DYNAMIC_L2.search(line):
            findings.append(
                ScanFinding(
                    severity="dangerous",
                    pattern_name="dynamic_download_l2",
                    matched_text=line.strip()[:200],
                    file_path=rel_path,
                    line_number=line_no,
                    category="dynamic_download",
                    pattern_id="DD-L2",
                )
            )
    return findings


def _scan_dependencies(skill_dir: Path) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    req = skill_dir / "requirements.txt"
    pkg = skill_dir / "package.json"
    names: list[str] = []
    if req.is_file():
        for line in req.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            names.append(re.split(r"[<>=!]", line)[0].strip().lower())
    if pkg.is_file():
        import json

        try:
            data = json.loads(pkg.read_text(encoding="utf-8", errors="replace"))
            for section in ("dependencies", "devDependencies"):
                deps = data.get(section) or {}
                if isinstance(deps, dict):
                    names.extend(str(k).lower() for k in deps)
        except json.JSONDecodeError:
            pass
    for name in names:
        base = name.split("/")[-1]
        if SUSPICIOUS_PKG_KEYWORDS.search(base):
            findings.append(
                ScanFinding(
                    severity="dangerous",
                    pattern_name="suspicious_dependency",
                    matched_text=name,
                    file_path="requirements.txt/package.json",
                    line_number=0,
                    category="supply_chain",
                    pattern_id="DEP-001",
                )
            )
            continue
        if base not in KNOWN_NPM and base not in KNOWN_PIP and len(base) > 3:
            for known in list(KNOWN_NPM) + list(KNOWN_PIP):
                if _levenshtein(base, known) == 1:
                    findings.append(
                        ScanFinding(
                            severity="caution",
                            pattern_name="typosquat_dependency",
                            matched_text=f"{name} ~ {known}",
                            file_path="requirements.txt/package.json",
                            line_number=0,
                            category="supply_chain",
                            pattern_id="DEP-002",
                        )
                    )
                    break
    return findings


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (ca != cb)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]


def _iter_scan_files(skill_dir: Path, strategy: ScanStrategy) -> list[Path]:
    files: list[Path] = []
    if strategy.scan_skill_md_only:
        skill_md = skill_dir / "SKILL.md"
        if skill_md.is_file():
            return [skill_md]
        for f in skill_dir.rglob("*.md"):
            if f.is_file():
                files.append(f)
        return files[:20]
    for f in skill_dir.rglob("*"):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext in SCANNABLE_EXTENSIONS or f.name == "SKILL.md":
            files.append(f)
    return files


def scan_skill_v2(
    skill_dir: Path,
    *,
    source: str = "agent-created",
    config: GuardConfig | None = None,
    deep: bool = False,
) -> ScanResult:
    """Run YAML-based guard v2 scan with tier-aware strategy."""
    t0 = time.monotonic()
    cfg = config or load_guard_config()
    skill_dir = Path(skill_dir).expanduser().resolve(strict=False)
    ps = load_pattern_set()
    all_findings: list[ScanFinding] = []

    if skill_dir.is_dir():
        stats = compute_code_stats(skill_dir)
        tier = classify_tier(stats, scan_mode=cfg.scan_mode if not deep else "full")
        strategy = get_scan_strategy(tier, scan_mode=cfg.scan_mode if not deep else "full")
        all_findings.extend(_check_structure(skill_dir))
        cat_filter: set[str] | None = None
        if strategy.md_only_categories and cfg.scan_mode == "quick":
            cat_filter = set(strategy.md_only_categories)
        for f in _iter_scan_files(skill_dir, strategy):
            rel = str(f.relative_to(skill_dir))
            if _path_excluded(rel, ps.exclude_globs):
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            all_findings.extend(
                _scan_text_v2(text, rel, ps.patterns, category_filter=cat_filter)
            )
            if not strategy.skip_url_full:
                all_findings.extend(_scan_urls(text, rel))
            if not strategy.skip_entropy:
                all_findings.extend(_scan_entropy(text, rel))
            all_findings.extend(_scan_dynamic_nesting(text, rel))
        if not strategy.skip_dep or deep:
            all_findings.extend(_scan_dependencies(skill_dir))
    elif skill_dir.is_file():
        try:
            text = skill_dir.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ScanResult(verdict="safe", findings=[], source=source)
        all_findings.extend(_scan_text_v2(text, skill_dir.name, ps.patterns))
    else:
        return ScanResult(verdict="safe", findings=[], source=source)

    elapsed = time.monotonic() - t0
    if elapsed > cfg.scan_timeout_seconds:
        all_findings.append(
            ScanFinding(
                severity="caution",
                pattern_name="scan_timeout",
                matched_text=f"{elapsed:.1f}s",
                file_path="(scan)",
                line_number=0,
                category="meta",
                pattern_id="META-TIMEOUT",
            )
        )

    score, grade = compute_score_and_grade(all_findings)
    tier = None
    if skill_dir.is_dir():
        tier = classify_tier(compute_code_stats(skill_dir), scan_mode=cfg.scan_mode)

    result = ScanResult(
        verdict=merge_verdict(all_findings),
        findings=all_findings,
        source=source,
        score=score,
        grade=grade,
        tier=tier,
        pattern_set_version=ps.pattern_set_version,
    )
    logger.info(
        "skill_scan skill=%s tier=%s verdict=%s score=%s grade=%s duration_ms=%.0f pattern_version=%s",
        skill_dir,
        tier,
        result.verdict,
        score,
        grade,
        elapsed * 1000,
        ps.pattern_set_version,
    )
    return result


def scan_markdown_with_fenced_blocks(
    text: str,
    *,
    source: str = "community",
    config: GuardConfig | None = None,
) -> ScanResult:
    """Scan SKILL.md body plus each executable fenced code block separately."""
    import tempfile

    cfg = config or load_guard_config()
    ps = load_pattern_set()
    all_findings: list[ScanFinding] = []

    all_findings.extend(_scan_text_v2(text, "SKILL.md", ps.patterns))
    all_findings.extend(_scan_urls(text, "SKILL.md"))
    all_findings.extend(_scan_dynamic_nesting(text, "SKILL.md"))
    for idx, (lang, body, _) in enumerate(extract_fenced_code_blocks(text)):
        rel = f"SKILL.md#block-{idx + 1}({lang})"
        all_findings.extend(_scan_text_v2(body, rel, ps.patterns, apply_fp_filter=False))
        all_findings.extend(_scan_entropy(body, rel))
        all_findings.extend(_scan_dynamic_nesting(body, rel))

    with tempfile.TemporaryDirectory() as td:
        skill_dir = Path(td) / "_skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(text, encoding="utf-8")
        stats = compute_code_stats(skill_dir)
    tier = classify_tier(stats, scan_mode=cfg.scan_mode)
    score, grade = compute_score_and_grade(all_findings)
    return ScanResult(
        verdict=merge_verdict(all_findings),
        findings=all_findings,
        source=source,
        score=score,
        grade=grade,
        tier=tier,
        pattern_set_version=ps.pattern_set_version,
    )


async def verify_findings_with_llm(findings: list[ScanFinding]) -> list[ScanFinding]:
    """Optional LLM pass — drops findings classified as false_positive (stub: no-op when unavailable)."""
    if not findings:
        return findings
    try:
        from agenticx.learning.config import load_learning_config

        cfg = load_learning_config()
        model = getattr(cfg, "review_model", None) or "default"
        _ = model
    except Exception:
        return findings
    # Deterministic fallback: keep findings unchanged until LLM wiring is configured.
    return findings
