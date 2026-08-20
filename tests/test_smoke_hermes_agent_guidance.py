#!/usr/bin/env python3
"""Smoke test for SKILLS_LEARNING_GUIDANCE injection in meta_agent prompts.

Validates hermes-agent proposal v2 §4.2.4.

Author: Damon Li
"""

from __future__ import annotations

import inspect

import pytest


class TestSkillsLearningGuidance:
    """Verify the guidance block is present in the shared skill authoring module."""

    def test_guidance_text_in_prompt_module(self) -> None:
        from agenticx.runtime.prompts import skill_authoring

        source = inspect.getsource(skill_authoring)
        assert "Skill 学习协议" in source

    def test_guidance_mentions_skill_manage(self) -> None:
        block = __import__(
            "agenticx.runtime.prompts.skill_authoring",
            fromlist=["build_skill_authoring_prompt_block"],
        ).build_skill_authoring_prompt_block()
        assert "skill_manage" in block
        assert "action='create'" in block or "action='patch'" in block

    def test_guidance_requires_user_confirm(self) -> None:
        block = __import__(
            "agenticx.runtime.prompts.skill_authoring",
            fromlist=["build_skill_authoring_prompt_block"],
        ).build_skill_authoring_prompt_block()
        assert "用户确认" in block or "confirm" in block.lower()

    def test_guidance_before_skill_manage_spec(self) -> None:
        block = __import__(
            "agenticx.runtime.prompts.skill_authoring",
            fromlist=["build_skill_authoring_prompt_block"],
        ).build_skill_authoring_prompt_block()
        guidance_pos = block.find("Skill 学习协议")
        spec_pos = block.find("skill_manage / skill_import_repo")
        assert 0 <= guidance_pos < spec_pos
        # 详细参数规范（大文件走 from_url/from_path、frontmatter 格式、落盘自检）
        # 搬去了 skill_manage 自己的 description，见 tool_discipline.SKILL_MANAGE_USAGE。
        from agenticx.runtime.prompts.tool_discipline import SKILL_MANAGE_USAGE

        assert "discoverable=true" in SKILL_MANAGE_USAGE
        assert "discoverable=true" not in block
