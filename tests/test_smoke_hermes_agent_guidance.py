#!/usr/bin/env python3
"""Smoke test for SKILLS_LEARNING_GUIDANCE injection in meta_agent prompts.

Validates hermes-agent proposal v2 §4.2.4.

Author: Damon Li
"""

from __future__ import annotations

import pytest


class TestSkillsLearningGuidance:
    """Verify the guidance block is present in the system prompt template."""

    def test_guidance_text_in_prompt_module(self) -> None:
        from agenticx.runtime.prompts import meta_agent
        import inspect
        source = inspect.getsource(meta_agent)
        assert "Skill 学习协议" in source, "SKILLS_LEARNING_GUIDANCE block not found in meta_agent.py"

    def test_guidance_mentions_skill_manage(self) -> None:
        from agenticx.runtime.prompts import meta_agent
        import inspect
        source = inspect.getsource(meta_agent)
        assert "skill_manage" in source
        assert "action='create'" in source or "action='patch'" in source

    def test_guidance_requires_user_confirm(self) -> None:
        from agenticx.runtime.prompts import meta_agent
        import inspect
        source = inspect.getsource(meta_agent)
        assert "用户确认" in source or "confirm" in source.lower()

    def test_guidance_before_skill_manage_spec(self) -> None:
        from agenticx.runtime.prompts import meta_agent
        import inspect
        source = inspect.getsource(meta_agent)
        guidance_pos = source.find("Skill 学习协议")
        spec_pos = source.find("skill_manage 使用规范")
        assert guidance_pos < spec_pos, "Guidance should appear before skill_manage spec"
