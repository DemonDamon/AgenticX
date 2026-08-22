#!/usr/bin/env python3
"""Shared system-prompt blocks for skill authoring and persistence.

Author: Damon Li
"""

from __future__ import annotations


def build_skill_authoring_prompt_block() -> str:
    """Prompt guidance for Meta-Agent and avatar sessions when saving skills."""
    return (
        "## Skill 学习协议\n"
        "- 完成复杂任务（5+ 工具调用）后，考虑将成功方法保存为 skill（`skill_manage` action='create'）。\n"
        "- 使用 skill 过程中发现不完整/过时/错误，**立即** `skill_manage` action='patch' 更新，不要等用户要求。\n"
        "- 修复棘手错误或发现非显然工作流后，主动提议保存为 skill。\n"
        "- 创建/删除 skill 前需与用户确认。\n"
        "- 简单的一次性任务无需保存。\n\n"
        "## skill_manage / skill_import_repo\n"
        "- 落盘 skill 的唯一入口是 `skill_manage`（批量用 `skill_import_repo`）；"
        "**禁止**用 `bash_exec` / `file_write` / `file_edit` 直接写 `~/.agenticx/skills/`。\n"
        "- 完整的参数规范、大文件走 from_url/from_path 的路径、frontmatter 格式与落盘自检，"
        "都写在 `skill_manage` 工具自己的 description 里；该工具可能未随本轮请求发送 schema，"
        "直接调用即可，系统会自动加载。\n\n"
    )
