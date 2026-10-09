#!/usr/bin/env python3
"""Inbound guard for SkillHub install prompts (stale Meta + clear install intent).

Mirrors desktop/src/utils/skillhub-install-prompt.ts so Studio / Chat can refuse
paste/history reuse of the old POST /api/registry/install dead path, and force
deterministic skillhub/install for ``@ns/slug`` / 「安装 xxx skill」 intents.

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

# Entire-message @ns/slug (or ns/slug) — chat install shorthand.
_AT_REF_ONLY = re.compile(
    r"^\s*@?([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)(?:@[\w.-]+)?\s*$"
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
    re.compile(r"\bskillhub\s+install\s+(@?[\w./-]+)", re.I),
    # Prefer @ns/slug before patterns that treat trailing "skill" as a keyword.
    re.compile(r"(?:请)?安装\s*(@[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)"),
    re.compile(r"\binstall\s+(@[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)", re.I),
    re.compile(r"@([A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)"),
    # 「安装 xxx skill」 / 「安装技能 xxx」 / install skill xxx
    re.compile(
        r"(?:请)?安装\s*(?:SkillHub\s*)?(?:第三方技能\s*)?"
        r"[「「\"']?(@?[A-Za-z0-9][A-Za-z0-9._/-]*)[」」\"']?\s+(?:skill|技能)\b",
        re.I,
    ),
    re.compile(
        r"(?:请)?安装\s*(?:技能|skill)\s*[「「\"']?(@?[A-Za-z0-9][A-Za-z0-9._/-]*)[」」\"']?",
        re.I,
    ),
    re.compile(r"\binstall\s+(?:the\s+)?skill\s+(@?[\w./-]+)", re.I),
)

_INSTALL_VERB = re.compile(
    r"(?:请)?安装|\binstall\b|skillhub\s+install|installFromSkillHub|"
    r"skills_store_cli\.py|SkillHub\s*第三方技能|第三方技能",
    re.I,
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
    """Best-effort skill slug / @ns/slug from SkillHub install copy."""
    body = str(text or "")
    m = _AT_REF_ONLY.match(body)
    if m:
        return f"@{m.group(1)}/{m.group(2)}"
    for pattern in _SLUG_PATTERNS:
        match = pattern.search(body)
        if not match:
            continue
        slug = str(match.group(1) or "").strip()
        if slug and slug.lower() not in {"skillhub", "skill", "the", "a", "an", "registry"}:
            if (
                "/" in slug
                and not slug.startswith("@")
                and not slug.startswith("registry/")
                and not slug.startswith("http")
            ):
                return f"@{slug}"
            return slug
    return None


def _is_clear_skillhub_install_intent(text: str) -> bool:
    """True for @ns/slug shorthand or clear 「安装 … skill」 / skillhub install copy."""
    body = str(text or "").strip()
    if not body:
        return False
    if _AT_REF_ONLY.match(body):
        return True
    slug = extract_skillhub_install_slug(body)
    if not slug:
        return False
    # Require an install/SkillHub verb so ordinary chat mentioning @ns/slug mid-sentence
    # without install intent is not forced through Desktop IPC.
    if _AT_REF_ONLY.match(body):
        return True
    return bool(_INSTALL_VERB.search(body))


def classify_skillhub_inbound_install_prompt(text: str) -> dict:
    """Return {hit, slug, reason, kind} for inbound intercept decisions.

    kind is ``forbidden_meta`` (old dead-path copy) or ``install_intent``
    (``@ns/slug`` / clear SkillHub install phrasing). Callers must force
    Desktop IPC / skillhub_adapter deterministic install — never Meta bash-curl
    of public skillhub.cn fake registry/install.
    """
    body = str(text or "")
    if not body.strip():
        return {"hit": False, "slug": None, "reason": "", "kind": ""}

    if is_forbidden_skillhub_agent_install_prompt(body):
        slug = extract_skillhub_install_slug(body)
        return {
            "hit": True,
            "slug": slug,
            "kind": "forbidden_meta",
            "reason": (
                "拦截旧版 SkillHub Meta 安装提示词（含 POST /api/registry/install "
                "或先装商店文案）。请改用 Desktop 确定性安装 "
                "(installFromSkillHub / POST /api/registry/skillhub/install)。"
            ),
        }

    if _is_clear_skillhub_install_intent(body):
        slug = extract_skillhub_install_slug(body)
        return {
            "hit": True,
            "slug": slug,
            "kind": "install_intent",
            "reason": (
                "拦截 SkillHub 安装意图（@ns/slug 或「安装 … skill」）。"
                "请改用 Desktop 确定性安装 "
                "(installFromSkillHub / skillhub_adapter / "
                "POST /api/registry/skillhub/install)，禁止 bash-curl skillhub.cn "
                "假 registry/install。"
            ),
        }

    return {"hit": False, "slug": None, "reason": "", "kind": ""}
