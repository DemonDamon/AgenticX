"""Detect quantitative claims without query_data_source backing in the same turn.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Sequence

_SUSPECT_PATTERN = re.compile(
    r"(涨了|跌了|收盘于|收于|GDP\s*增速|同比增长|环比|涨跌幅)\s*[\d.]+%?"
)

_NUDGE_MESSAGE = (
    "[系统纪律违规] 检测到回复中包含具体量化数据，但本轮未见 query_data_source 工具调用记录。"
    "请先调用 list_data_sources / query_data_source 核实真实数据后再回答，"
    "禁止使用训练记忆中的数字；若数据源不可用须明确告知用户。"
)


def detect_uncited_quant_claim(
    reply_text: str, tool_calls_this_turn: Sequence[str]
) -> str | None:
    """Return a nudge message if reply asserts quant facts without backing tool calls."""
    if "query_data_source" in tool_calls_this_turn:
        return None
    if _SUSPECT_PATTERN.search(reply_text):
        return _NUDGE_MESSAGE
    return None
