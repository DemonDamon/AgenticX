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
        "## skill_manage / skill_import_repo 使用规范（必须遵守）\n"
        "- 用户说「落盘 skill / 封装成 skill / 工具调用太多」时：**先** `skill_use(skill-creator)` 提炼 workflow，**再** `skill_manage` 落盘。\n"
        "- 安装/创建 skill 时，必须调用 `skill_manage` 或批量时使用 `skill_import_repo`，**所有参数必须在同一次调用中完整填写，禁止发出空参数 `{}`**。\n"
        "- **禁止**用 `bash_exec` / `file_write` / `file_edit` 直接写入 `~/.agenticx/skills/`；唯一落盘入口是 `skill_manage`。\n"
        "- **单包 / 小文件 create**：`action='create'`、`name=<skill目录名>`、`content=<完整SKILL.md文本>`（仅当 SKILL.md 足够小）。\n"
        "- **大文件 / bulk create**：禁止把 SKILL.md 全文塞进 `content` 经 LLM context 中转。优先：\n"
        "  - `skill_import_repo(repo='owner/name', dry_run=true)` 预览 → `skill_import_repo(..., dry_run=false)` 一次安装；或\n"
        "  - `skill_manage(action='create', name=..., from_url=<raw.githubusercontent.com/.../SKILL.md>)`；或\n"
        "  - `bash_exec` 下载到本地后 `skill_manage(from_path=<绝对路径>)`。\n"
        "- SKILL.md 内容必须以 YAML frontmatter 开头：`---\\nname: <名称>\\ndescription: <描述>\\n---`，后接技能正文。\n"
        "- skill 名称规则：只含字母/数字/连字符/下划线，支持子路径如 `engineering/tdd`，禁止空格和前导点。\n"
        "- 落盘后必须调用 `skill_list` 或读取 `skill_manage` 返回的 `discoverable` 字段自检。\n"
        "- **仅当** `skill_manage` 返回 `discoverable=true` 时，才可对用户声称「已在设置 → Skills 可见」；若 `frontmatter_fixed` 非空，须在回复中说明自动补全项。\n"
        "- ZIP 单包安装：`bash_exec` 下载解压 → `skill_manage(from_path=...)` 或 `from_url`，**不要** `file_read` 全文再 `content=`。\n"
        "- **禁止在 `<think>` 里想好参数后发空调用**；若上一次 skill_manage 报参数缺失，必须重新构造完整参数重试，不得再次发空。\n\n"
    )
