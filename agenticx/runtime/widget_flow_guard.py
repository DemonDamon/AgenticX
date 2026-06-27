"""Detect text-based flow diagrams that should use show_widget instead.

Author: Damon Li
"""

from __future__ import annotations

import re

_ARROW_LINE = re.compile(
    r"^[ \t]*\S+.*?(?:->|→|-->|==>).*?\S+",
    re.MULTILINE,
)

_VERTICAL_ARROW = re.compile(
    r"^[ \t]*[↓▼↑▲|│]\s*$",
    re.MULTILINE,
)

_FENCED_TEXT_BLOCK = re.compile(
    r"```(?:text|TEXT|)\s*\n([\s\S]*?)```",
)

_ASCII_BOX = re.compile(r"[┌┐└┘├┤┬┴┼│─╔╗╚╝║═\+\-]{3,}")


def contains_text_flow_diagram(text: str) -> bool:
    """Return True if the assistant text contains a text-based flow diagram.

    Heuristics:
    - A fenced ```text``` (or no-lang) block with >=2 arrow lines or >=2 vertical arrows
    - Inline text with >=3 consecutive lines that form an arrow chain
    """
    for m in _FENCED_TEXT_BLOCK.finditer(text):
        block = m.group(1)
        arrow_count = len(_ARROW_LINE.findall(block))
        vert_count = len(_VERTICAL_ARROW.findall(block))
        if arrow_count >= 2 or vert_count >= 2 or (arrow_count + vert_count) >= 3:
            return True
        if _ASCII_BOX.search(block):
            return True

    lines = text.split("\n")
    consecutive_flow = 0
    for line in lines:
        stripped = line.strip()
        is_flow = (
            _ARROW_LINE.match(line)
            or stripped in ("↓", "▼", "↑", "│", "|", "↓")
            or _VERTICAL_ARROW.match(line)
        )
        if is_flow:
            consecutive_flow += 1
            if consecutive_flow >= 2:
                return True
        elif stripped:
            consecutive_flow = 0

    return False


WIDGET_FLOW_RETRY_HINT = (
    "[系统纪律违规] 你的回复包含了文字流程图（箭头链/↓/ASCII框线）。"
    "这是严重违规——必须使用 `show_widget` 工具渲染所有流程/链路/架构图。"
    "请立即重新回答：先调用 show_widget(title=..., widget_code='<svg ...>') 输出 SVG 流程图，"
    "然后再写正文解读。禁止在正文或代码块中用文字画流程。"
)
