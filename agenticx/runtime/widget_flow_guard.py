"""Detect text-based flow diagrams that should use show_widget instead.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_ARROW_TOKENS = ("-->", "==>", "->", "→")

_VERTICAL_ARROW = re.compile(
    r"^[ \t]*[↓▼↑▲|│]\s*$",
    re.MULTILINE,
)

_FENCE_LINE = re.compile(r"^( {0,3})(`{3,}|~{3,})(.*)$")
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")
_BOX_DRAWING = re.compile(r"[┌┐└┘├┤┬┴┼│─╔╗╚╝║═]")
_PLUS_BOX = re.compile(r"\+[-=]{2,}\+")

WIDGET_FLOW_MAX_RETRIES_PER_SESSION = 1
# SSE payload only. Desktop treats discard as an ephemeral rewrite status and
# does not persist this sentence in the transcript.
WIDGET_FLOW_DISCARD_NOTICE = "正文按图示规范重写中，上一稿已撤回。"


def _line_has_arrow(line: str) -> bool:
    """Return True if the line contains an arrow token anywhere."""
    return any(token in line for token in _ARROW_TOKENS)


def _arrow_token_count(line: str) -> int:
    count = 0
    index = 0
    while index < len(line):
        for token in _ARROW_TOKENS:
            if line.startswith(token, index):
                count += 1
                index += len(token)
                break
        else:
            index += 1
    return count


def _is_leading_arrow(line: str) -> bool:
    rest = _LIST_ITEM.sub("", line, count=1)
    return bool(re.match(r"^\s*(?:-->|==>|->|→)", rest))


def _is_prose_flow_line(line: str) -> bool:
    """Return True for a prose line that is drawing a flow, not stating implication."""
    stripped = line.strip()
    if not stripped:
        return False
    if stripped in ("↓", "▼", "↑", "│", "|") or bool(_VERTICAL_ARROW.match(line)):
        return True
    arrows = _arrow_token_count(line)
    if arrows >= 2:
        return True
    if arrows == 1 and _is_leading_arrow(line):
        return True
    if arrows >= 1 and not _LIST_ITEM.match(line):
        return True
    return False


def _has_ascii_box(text: str) -> bool:
    """Require real box-drawing marks or +---+ frames, not markdown --- / tables."""
    return bool(_BOX_DRAWING.search(text) or _PLUS_BOX.search(text))


def _split_fences(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Split markdown into prose plus (info_string, body) fences.

    Uses a line state machine so a language-fence closer cannot open a bare fence.
    """
    lines = text.split("\n")
    prose_lines: list[str] = []
    fences: list[tuple[str, str]] = []
    index = 0
    while index < len(lines):
        match = _FENCE_LINE.match(lines[index])
        if not match:
            prose_lines.append(lines[index])
            index += 1
            continue
        fence = match.group(2)
        rest = match.group(3).strip()
        info = rest.split(" ", 1)[0] if rest else ""
        marker = fence[0]
        min_len = len(fence)
        body_lines: list[str] = []
        index += 1
        while index < len(lines):
            closer = _FENCE_LINE.match(lines[index])
            if (
                closer
                and closer.group(2)[0] == marker
                and len(closer.group(2)) >= min_len
                and not closer.group(3).strip()
            ):
                index += 1
                break
            body_lines.append(lines[index])
            index += 1
        fences.append((info, "\n".join(body_lines)))
    return "\n".join(prose_lines), fences


def _is_text_fence(info: str) -> bool:
    return info.lower() in ("", "text")


def _snippet(text: str, limit: int = 160) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1] + "…"


@dataclass(frozen=True)
class TextFlowHit:
    reason: str
    snippet: str


def find_text_flow_diagram_hits(text: str) -> list[TextFlowHit]:
    """Return detector hits with reason + snippet for retry hints."""
    hits: list[TextFlowHit] = []
    prose, fences = _split_fences(text)
    for info, body in fences:
        if not _is_text_fence(info):
            continue
        lines = body.split("\n")
        arrow_count = sum(1 for line in lines if _line_has_arrow(line))
        vert_count = len(_VERTICAL_ARROW.findall(body))
        if arrow_count >= 2 or vert_count >= 2 or (arrow_count + vert_count) >= 3:
            hits.append(TextFlowHit("无语言代码块中的箭头链", _snippet(body)))
        elif _has_ascii_box(body):
            hits.append(TextFlowHit("无语言代码块中的 ASCII 框图", _snippet(body)))

    consecutive = 0
    first_flow = ""
    for line in prose.split("\n"):
        if _is_prose_flow_line(line):
            consecutive += 1
            if consecutive == 1:
                first_flow = line
            if consecutive >= 2:
                hits.append(
                    TextFlowHit("正文连续箭头行", _snippet(f"{first_flow}\n{line}"))
                )
                break
        elif line.strip():
            consecutive = 0
    return hits


def contains_text_flow_diagram(text: str) -> bool:
    """Return True if the assistant text contains a text-based flow diagram.

    Heuristics:
    - A fenced ```text``` (or no-lang) block with >=2 arrow lines, vertical
      arrows, or a real ASCII/box-drawing frame
    - Inline prose with >=2 consecutive flow lines (node hops / leading arrows /
      vertical arrows). Markdown list items with a single mid-line arrow
      (implication, not a diagram) are ignored.
    """
    return bool(find_text_flow_diagram_hits(text))


WIDGET_FLOW_RETRY_HINT = (
    "[系统纪律违规] 你的回复包含了文字流程图（箭头链/↓/ASCII框线）。"
    "所有流程/链路/架构/实现路径必须用 `show_widget` 输出 SVG 图（优先），"
    "或在简单场景用 ```mermaid``` 代码块；"
    "禁止在正文或无语言标注的 ``` 代码块里用文字箭头或 ASCII 框线画流程。"
    "若本轮已调用过 `show_widget` 展示架构，正文只写分步解读，不得再重复画架构。"
    "代码示例须标注语言（```python / ```json / ```yaml），Prompt 模板用 ```yaml，"
    "禁止裸 ``` 块（会显示为 TEXT）。请立即重新回答。"
)


def build_widget_flow_retry_hint(text: str) -> str:
    """Build the retry system hint, appending the first hit snippet when present."""
    hits = find_text_flow_diagram_hits(text)
    if not hits:
        return WIDGET_FLOW_RETRY_HINT
    hit = hits[0]
    return f"{WIDGET_FLOW_RETRY_HINT}命中类型：{hit.reason}。命中片段：{hit.snippet}"
