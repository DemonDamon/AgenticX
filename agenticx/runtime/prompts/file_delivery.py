"""Prompt guidance for choosing how substantial deliverables are returned."""

from __future__ import annotations


FILE_DELIVERY_CHOICE_PROMPT_MARKER = "## 文件交付方式选择（仅交互会话）"


def build_file_delivery_choice_prompt_block() -> str:
    """Build the interactive-only, narrowly scoped delivery-choice rule."""
    return (
        f"{FILE_DELIVERY_CHOICE_PROMPT_MARKER}\n"
        "- 仅当当前请求明确要一份完整、可复用的交付物，且内容较长或有保存、分享、提交、归档价值时，主动询问是直接在对话中给出，还是生成文件。例如：多章节报告、方案、实施计划、会议纪要、手册、研究简报、规格、长文、简历、成套材料或大型结构化清单。\n"
        "- 下列情况必须跳过询问：用户已说「只在对话中回答」；已明确要求生成/保存/导出文件；已指定格式或路径。后两类应直接按要求交付，不要再问「是否生成文件」。\n"
        "- 下列任务也不触发：普通问答、解释、分析、对比、建议、头脑风暴；短文润色/翻译/摘要；代码或仓库修改；编辑或转换用户已附件；图像、图表、小组件、音视频；安装、构建、配置、下载、部署或数据抓取；邮件/IM 草稿（除非明确要保存）。\n"
        "- 符合条件时，优先调用 `request_clarification`："
        "`{\"prompt\":\"这份内容可以直接在对话中给出，也可生成文件。请选择交付方式；如需特定格式或路径，可直接填写。\","
        "\"decisions\":[{\"id\":\"delivery_mode\",\"question\":\"希望如何交付？\","
        "\"options\":[\"直接在对话中给出\",\"生成文件（按内容选择合适格式）\"]}],"
        "\"allow_free_text\":true}`。获得答复后在同一回合继续交付。\n"
        "- 同一交付物只问一次；用户已经选择或已回答时不要重复询问。如当前工具集确实没有 `request_clarification`，才用一句简短正文提问。\n"
        "- 这只是交付形式选择，不是文件写入授权。实际写文件仍必须遵守 `confirm_required`，不得改用 `request_action_confirmation`。\n"
        "- 不得将本规则带入 delegated/subagent、automation/unattended 或 loop 执行路径，避免无交互门的任务阻塞。\n\n"
    )


def has_file_delivery_choice_prompt_block(prompt: str | None) -> bool:
    """Return whether the exact delivery-choice block marker is present."""
    return FILE_DELIVERY_CHOICE_PROMPT_MARKER in str(prompt or "")
