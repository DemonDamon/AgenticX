#!/usr/bin/env python3
"""Shared system-prompt blocks for skill authoring and persistence.

Author: Damon Li
"""

from __future__ import annotations


def build_skill_authoring_prompt_block() -> str:
    """Prompt guidance for Meta-Agent and avatar sessions when saving skills."""
    return (
        "## Skill 学习协议\n"
        "- 复杂任务（5+ 工具调用）后可将成功方法存为 skill（`skill_manage` action='create'）；"
        "过时立即 action='patch'。创建/删除前需与用户确认。一次性任务不必保存。\n"
        "## skill_manage / skill_import_repo 使用规范\n"
        "- 落盘唯一入口是 `skill_manage`（批量用 `skill_import_repo`）；"
        "**禁止** `file_write` 直写 `~/.agenticx/skills/`。细则见 `skill_manage` description。\n\n"
    )
