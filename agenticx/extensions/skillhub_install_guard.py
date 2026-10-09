#!/usr/bin/env python3
"""Inbound guard for stale SkillHub Meta install prompts.

Mirrors desktop/src/utils/skillhub-install-prompt.ts fingerprints so Studio can
refuse paste/history reuse of the old POST /api/registry/install dead path and
force deterministic skillhub/install instead.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Optional, Tuple

# Keep in sync with SKILLHUB_AGENT_PROMPT_FORBIDDEN (TypeScript).
SKILLHUB_AGENT_PROMPT_FORBIDDEN: Tuple[str, ...] = (
    "POST /api/registry/install",
    "/api/registry/install",
    "请先检查是否已安装 SkillHub 商店",
    "优先调用本机 Studio API",
    "根据 https://skillhub-",
    "请先装商店",
    "安装 SkillHub 商店",
    "先检查是否已安装 SkillHub",
)

_SLUG_PATTERNS: Tuple[re.Pattern[str], ...] = (
    re.compile(r"SkillHub\s*第三方技能[「「\"']([^」」\"']+)[」」\"']"),
    re.compile(r"请安装\s*SkillHub[^「「\"'\n]{0,40}[「「\"']([^」」\"']+)[」」\"']"),
    re.compile(r"skills_store_cli\.py[^\n]*\binstall\s+(@?[\w./-]+)", re.I),
    re.compile(r"installFromSkillHub[^\n]{0,40}\b([A-Za-z0-9@_/.-]+)", re.I),
    re.compile(
        r"skillhub/install[^\n]{0,80}[\"']slug[\"']\s*:\s*[\"']([^\"']+)[\"']",
        re.I,
    ),
)


def _body_hits_forbidden(body: str, needle: str) -> bool:
    if needle in {"/api/registry/install", "POST /api/registry/install"}:
        stripped = re.sub(r"/api/registry/skillhub/install", "", body)
        return needle in stripped
    return needle in body


def is_forbidden_skillhub_agent_install_prompt(text: str) -> bool:
    """True when inbound text matches old Meta SkillHub install dead-path copy."""
    body = str(text or "")
    if not body.strip():
        return False
    return any(_body_hits_forbidden(body, needle) for needle in SKILLHUB_AGENT_PROMPT_FORBIDDEN)


def extract_skillhub_install_slug(text: str) -> Optional[str]:
    """Best-effort skill slug from old/new SkillHub install copy."""
    body = str(text or "")
    for pattern in _SLUG_PATTERNS:
        match = pattern.search(body)
        if not match:
            continue
        slug = str(match.group(1) or "").strip()
        if slug and slug.lower() != "skillhub":
            return slug
    return None


def classify_skillhub_inbound_install_prompt(text: str) -> dict:
    """Return {hit, slug, reason} for inbound intercept decisions."""
    body = str(text or "")
    if not is_forbidden_skillhub_agent_install_prompt(body):
        return {"hit": False, "slug": None, "reason": ""}
    slug = extract_skillhub_install_slug(body)
    return {
        "hit": True,
        "slug": slug,
        "reason": (
            "拦截旧版 SkillHub Meta 安装提示词（含 POST /api/registry/install "
            "或先装商店文案）。请改用 Desktop 确定性安装 "
            "(installFromSkillHub / POST /api/registry/skillhub/install)。"
        ),
    }
