#!/usr/bin/env python3
"""Smoke tests for code_dev session mode.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.cli.studio import StudioSession
from agenticx.runtime.prompts.code_mode import build_code_dev_prompt_blocks
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt
from agenticx.runtime.session_mode import CODE_DEV, DAILY_OFFICE, normalize_session_mode


def test_normalize_session_mode_defaults():
    assert normalize_session_mode(None) == DAILY_OFFICE
    assert normalize_session_mode("code_dev") == CODE_DEV
    assert normalize_session_mode("unknown") == DAILY_OFFICE


def test_code_dev_prompt_injected():
    session = StudioSession(session_mode=CODE_DEV, workspace_dir=".")
    block = build_code_dev_prompt_blocks(session)
    assert "Phase Gate" in block or "工作相位" in block
    assert "仓库骨架" in block


def test_daily_office_no_code_dev_block():
    session = StudioSession(session_mode=DAILY_OFFICE)
    assert build_code_dev_prompt_blocks(session) == ""


def test_meta_prompt_includes_code_dev():
    session = StudioSession(session_mode=CODE_DEV, workspace_dir=".")
    prompt = build_meta_agent_system_prompt(session)
    assert "code_dev" in prompt or "代码开发" in prompt


def test_ensure_code_dev_workflow_skill():
    from agenticx.runtime.prompts.code_mode import (
        CODE_DEV_WORKFLOW_SKILL,
        ensure_code_dev_workflow_skill,
    )

    session = StudioSession(session_mode=CODE_DEV, workspace_dir=".")
    ok = ensure_code_dev_workflow_skill(session)
    assert ok is True
    assert f"skill:{CODE_DEV_WORKFLOW_SKILL}" in session.context_files
