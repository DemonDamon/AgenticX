#!/usr/bin/env python3
"""Tests for SkillHub inbound install prompt guard.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.extensions.skillhub_install_guard import (
    classify_skillhub_inbound_install_prompt,
    extract_skillhub_install_slug,
    is_clear_skillhub_install_intent,
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
    assert hit.get("kind") == "forbidden_meta"
    assert "installFromSkillHub" in hit["reason"] or "skillhub/install" in hit["reason"]


def test_classify_miss_ordinary_chat() -> None:
    assert classify_skillhub_inbound_install_prompt("写个 hello")["hit"] is False
    assert classify_skillhub_inbound_install_prompt("安装依赖")["hit"] is False


def test_at_ns_slug_does_not_force_ipc_install() -> None:
    """Chat @ns/slug must NOT hit classify — conversation agent handles install."""
    hit = classify_skillhub_inbound_install_prompt("@indiv-ebandao/tiangong-skill")
    assert hit["hit"] is False
    # Still detectable as install phrasing for diagnostics / Settings UX.
    assert is_clear_skillhub_install_intent("@indiv-ebandao/tiangong-skill") is True


def test_install_at_ref_not_intercepted() -> None:
    hit = classify_skillhub_inbound_install_prompt("安装 @indiv-ebandao/tiangong-skill")
    assert hit["hit"] is False
    assert is_clear_skillhub_install_intent("安装 @indiv-ebandao/tiangong-skill") is True


def test_install_xxx_skill_not_intercepted() -> None:
    hit = classify_skillhub_inbound_install_prompt("请安装 tiangong-skill skill")
    assert hit["hit"] is False
    assert is_clear_skillhub_install_intent("请安装 tiangong-skill skill") is True


def test_skillhub_cli_install_not_intercepted() -> None:
    hit = classify_skillhub_inbound_install_prompt("skillhub install @indiv-seafish/archify")
    assert hit["hit"] is False
    assert is_clear_skillhub_install_intent("skillhub install @indiv-seafish/archify") is True
