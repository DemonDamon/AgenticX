"""Detect text-based flow diagrams that should use show_widget instead.

Author: Damon Li
"""

from __future__ import annotations

import re

_ARROW_TOKENS = ("->", "→", "-->", "==>")

_VERTICAL_ARROW = re.compile(
    r"^[ \t]*[↓▼↑▲|│]\s*$",
    re.MULTILINE,
)

_FENCED_TEXT_BLOCK = re.compile(
    r"```(?:text|TEXT|)\s*\n([\s\S]*?)```",
)

_ANY_FENCED_BLOCK = re.compile(r"```[^\n]*\n[\s\S]*?```")

_ASCII_BOX = re.compile(r"[┌┐└┘├┤┬┴┼│─╔╗╚╝║═\+\-]{3,}")

WIDGET_FLOW_MAX_RETRIES_PER_SESSION = 3


def _line_has_arrow(line: str) -> bool:
    """Return True if the line contains an arrow token anywhere.

    Deliberately does not require non-arrow content immediately before the
    arrow, since a common violating style prefixes each step with a leading
    arrow (e.g. "    -> step two") rather than chaining arrows mid-line.
    """
    return any(token in line for token in _ARROW_TOKENS)


def contains_text_flow_diagram(text: str) -> bool:
    """Return True if the assistant text contains a text-based flow diagram.

    Heuristics:
    - A fenced ```text``` (or no-lang) block with >=2 arrow lines or >=2 vertical arrows
    - Inline text with >=2 consecutive lines that form an arrow/vertical chain
    """
    for m in _FENCED_TEXT_BLOCK.finditer(text):
        block = m.group(1)
        lines = block.split("\n")
        arrow_count = sum(1 for line in lines if _line_has_arrow(line))
        vert_count = len(_VERTICAL_ARROW.findall(block))
        if arrow_count >= 2 or vert_count >= 2 or (arrow_count + vert_count) >= 3:
            return True
        if _ASCII_BOX.search(block):
            return True

    # Strip ALL fenced code blocks (any language, e.g. mermaid/svg/python)
    # before scanning prose for arrow chains. Legitimate diagram/code syntax
    # inside a properly-tagged fenced block must never trigger this guard;
    # only bare/```text``` blocks (handled above) and raw prose are checked.
    prose_text = _ANY_FENCED_BLOCK.sub("", text)

    lines = prose_text.split("\n")
    consecutive_flow = 0
    for line in lines:
        stripped = line.strip()
        is_flow = (
            _line_has_arrow(line)
            or stripped in ("↓", "▼", "↑", "│", "|")
            or bool(_VERTICAL_ARROW.match(line))
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
    "所有流程/链路/架构/实现路径必须用 `show_widget` 输出 SVG 图（优先），"
    "或在简单场景用 ```mermaid``` 代码块；"
    "禁止在正文或无语言标注的 ``` 代码块里用文字箭头或 ASCII 框线画流程。"
    "若本轮已调用过 `show_widget` 展示架构，正文只写分步解读，不得再重复画架构。"
    "代码示例须标注语言（```python / ```json / ```yaml），Prompt 模板用 ```yaml，"
    "禁止裸 ``` 块（会显示为 TEXT）。请立即重新回答。"
)
