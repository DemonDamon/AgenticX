#!/usr/bin/env python3
"""Execution-profile gate: pin the declared skill tier to the measured one.

The skill guard already classifies every skill directory into one of four
static tiers (T-MD / T-LITE / T-REF / T-HEAVY, ``guard_classify.py``).
This module turns that classification into an enforceable contract at the
install and load boundaries:

- a skill may declare its tier in SKILL.md frontmatter (``tier: T-REF``);
- install paths reject packages whose declared tier does not match the
  measured one (single skills, registry packages, AGX Bundles) before a
  single byte lands on disk;
- the loader refuses to register skills whose current content no longer
  matches the declared tier, so every serving method (list / read /
  prompt injection) stays closed;
- every rejection is mirrored into the persistent safety sinks
  (``agenticx/runtime/studio_safety.py``), so it survives restarts.

Skills without a declared tier (the entire legacy corpus) are untouched:
the gate is opt-in per declaration. Unknown or malformed tier values are
treated as undeclared and only logged — an attacker can simply omit the
field, so rejecting garbage values adds no security, only ecosystem
false positives.

Author: Damon Li
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from agenticx.skills.frontmatter import get_frontmatter_scalar
from agenticx.skills.guard_classify import classify_tier, compute_code_stats
from agenticx.skills.guard_types import SkillProfileCheck

logger = logging.getLogger("agenticx.skills")

#: The four static tiers produced by ``classify_tier`` (vocabulary pin).
SKILL_TIERS = ("T-MD", "T-LITE", "T-REF", "T-HEAVY")

#: The measured tier must not depend on the operator's scan mode:
#: ``quick`` forces T-MD and ``full`` forces the heavy side, both of which
#: would produce spurious results. Profile gating always measures with
#: the standard rules so install-time and load-time checks agree.
_MEASURE_SCAN_MODE = "standard"


class SkillProfileMismatchError(ValueError):
    """Raised by disk-landing install helpers when the declared tier is a lie."""


def read_declared_tier(content: str) -> Optional[str]:
    """Return the validated ``tier`` scalar from SKILL.md frontmatter.

    ``None`` when the frontmatter declares no tier or a value outside
    :data:`SKILL_TIERS` (after quote stripping and upper-casing, so
    ``"t-md"`` and ``T-MD`` are the same declaration).
    """
    raw = get_frontmatter_scalar(content, "tier")
    if raw is None:
        return None
    value = raw.strip().strip("\"'").upper()
    if value in SKILL_TIERS:
        return value
    logger.warning("ignoring unknown skill tier declaration: %r", raw)
    return None


def measure_tier(skill_dir: Path) -> Optional[str]:
    """Measure the current tier of a skill directory with the standard rules.

    Hidden dot-files (notably the ``.agx-skill-provenance.json`` sidecar the
    installers write) are excluded on purpose: they are installer
    bookkeeping, not skill content, and the landing helpers already refuse
    to copy them (``write_registry_skill_dir`` skips dot-file path parts).
    Staging only the visible files keeps the measurement identical before
    and after installation; without this a pure-markdown skill would
    measure T-LITE instead of T-MD the moment provenance lands beside it.
    """
    root = Path(skill_dir).expanduser().resolve(strict=False)
    if not root.is_dir():
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="agx-profile-") as td:
            staged = Path(td) / "_skill"
            staged.mkdir(parents=True)
            for src in sorted(root.rglob("*")):
                if not src.is_file():
                    continue
                rel = src.relative_to(root)
                if any(part.startswith(".") for part in rel.parts):
                    continue
                target = staged / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, target)
            return classify_tier(
                compute_code_stats(staged), scan_mode=_MEASURE_SCAN_MODE
            )
    except Exception:
        logger.warning("profile measurement failed for %s", root, exc_info=True)
        return None


def measure_tier_from_markdown(content: str) -> Optional[str]:
    """Measure the tier of an md-only skill from its SKILL.md text."""
    try:
        with tempfile.TemporaryDirectory(prefix="agx-profile-") as td:
            staged = Path(td) / "_skill"
            staged.mkdir(parents=True)
            (staged / "SKILL.md").write_text(content, encoding="utf-8")
            return classify_tier(
                compute_code_stats(staged), scan_mode=_MEASURE_SCAN_MODE
            )
    except Exception:
        logger.warning("profile markdown measurement failed", exc_info=True)
        return None


def check_skill_profile(skill_dir: Path) -> Optional[SkillProfileCheck]:
    """Compare the declared tier of a skill directory against the measured one.

    Returns ``None`` when the gate is off, the directory has no SKILL.md, no
    valid tier is declared (legacy skills pass through untouched), or the
    measurement itself failed (fail open: the pattern scan still ran, and a
    broken stat call must not brick installation).
    """
    from agenticx.runtime.harden_flags import skill_profile_gate_enabled

    if not skill_profile_gate_enabled():
        return None
    root = Path(skill_dir).expanduser().resolve(strict=False)
    skill_md = root / "SKILL.md"
    if not skill_md.is_file():
        return None
    try:
        content = skill_md.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return check_skill_profile_text(content, skill_dir=root)


def check_skill_profile_text(
    content: str, *, skill_dir: Optional[Path] = None
) -> Optional[SkillProfileCheck]:
    """Declared-vs-measured check for one SKILL.md text.

    ``skill_dir`` is the content root to measure (directory install paths);
    md-only callers omit it and the markdown text itself is staged and
    measured.
    """
    from agenticx.runtime.harden_flags import skill_profile_gate_enabled

    if not skill_profile_gate_enabled():
        return None
    declared = read_declared_tier(content)
    if declared is None:
        return None
    if skill_dir is not None and Path(skill_dir).is_dir():
        measured = measure_tier(skill_dir)
    else:
        measured = measure_tier_from_markdown(content)
    if measured is None:
        return None
    ok = declared == measured
    return SkillProfileCheck(
        declared=declared,
        measured=measured,
        ok=ok,
        reason="" if ok else f"tier mismatch: declared {declared}, measured {measured}",
    )


def note_profile_rejection(
    check: SkillProfileCheck,
    *,
    skill_name: str,
    action: str,
    boundary: str,
) -> None:
    """Persist one profile-gate rejection through the studio safety sinks.

    Best-effort: an audit failure never affects the decision (the caller
    has already rejected). The in-memory ring buffer is intentionally not
    used — it is the tool-dispatch pipeline log, not a persistent outlet.
    """
    try:
        from agenticx.runtime.studio_safety import emit_extension_gate_event

        emit_extension_gate_event(
            {
                "stage": "extension_profile_gate",
                "action": action,
                "tool_name": str(skill_name or ""),
                "rule_ids": ["tier_mismatch"],
                "severity": "WARN",
                "details": (
                    f"declared={check.declared} measured={check.measured} "
                    f"boundary={boundary}"
                ),
                "mode": "enforce",
                "session_id": "",
                "tool_call_id": "",
                "agent_id": "",
                "args_digest": "",
            }
        )
    except Exception:
        logger.debug("profile rejection audit failed", exc_info=True)
