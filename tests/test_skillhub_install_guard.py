#!/usr/bin/env python3
"""Tests for SkillHub inbound install prompt guard.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.extensions.skillhub_install_guard import (
    classify_skillhub_inbound_install_prompt,
    extract_skillhub_install_slug,
    is_forbidden_skillhub_agent_install_prompt,
)


OLD_COPY = "\n".join(
    [
        "请安装 SkillHub 第三方技能「archify」。",
        "1. 优先调用本机 Studio API：POST /api/registry/install，body 含 source 与 name。",
        "请先检查是否已安装 SkillHub 商店；若未安装，请根据 https://skillhub-xxx 安装 SkillHub 商店",
    ]
)


def test_forbidden_old_meta_prompt() -> None:
    assert is_forbidden_skillhub_agent_install_prompt(OLD_COPY) is True


def test_allows_skillhub_install_route() -> None:
    assert (
        is_forbidden_skillhub_agent_install_prompt(
            "use Desktop IPC POST /api/registry/skillhub/install"
        )
        is False
    )


def test_rejects_bare_registry_install() -> None:
    assert (
        is_forbidden_skillhub_agent_install_prompt(
            "curl http://127.0.0.1:3000/api/registry/install"
        )
        is True
    )


def test_extract_slug_from_old_copy() -> None:
    assert extract_skillhub_install_slug(OLD_COPY) == "archify"


def test_classify_hit_forces_deterministic_path() -> None:
    hit = classify_skillhub_inbound_install_prompt(OLD_COPY)
    assert hit["hit"] is True
    assert hit["slug"] == "archify"
    assert "installFromSkillHub" in hit["reason"] or "skillhub/install" in hit["reason"]


def test_classify_miss_ordinary_chat() -> None:
    assert classify_skillhub_inbound_install_prompt("写个 hello")["hit"] is False
