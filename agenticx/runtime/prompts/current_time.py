#!/usr/bin/env python3
"""Current local time block injected into agent system prompts.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timezone

_WEEKDAY_CN = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")


def get_current_time_facts() -> dict[str, str]:
    """Return authoritative local clock facts from the host machine.

    Returns:
        Mapping with local ISO datetime, date, Chinese weekday name, timezone
        label, UTC offset and UTC ISO datetime.
    """
    local = datetime.now().astimezone()
    return {
        "local_iso": local.strftime("%Y-%m-%d %H:%M:%S"),
        "date": local.strftime("%Y-%m-%d"),
        "weekday_cn": _WEEKDAY_CN[local.weekday()],
        "tz_name": local.tzname() or "",
        "utc_offset": local.strftime("%z"),
        "utc_iso": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    }


def build_current_time_block() -> str:
    """Build the system-prompt section describing the authoritative current time."""
    facts = get_current_time_facts()
    return (
        "## 当前时间（权威，来自本机系统时钟）\n"
        f"- 本地时间：{facts['local_iso']}（{facts['weekday_cn']}，"
        f"时区 {facts['tz_name']} UTC{facts['utc_offset']}）\n"
        f"- 今天日期：{facts['date']}\n"
        "- 回答「今天几号 / 现在几点 / 今年是哪一年 / 距离某日还有多久」等时间问题时，"
        "**必须**以上述本机时间为唯一权威来源。\n"
        "- **禁止**用 `web_search` 查询当前日期、星期或时刻；网页快照日期不可信，"
        "曾出现搜索结果给出过期日期导致回答错误一年以上的事故。\n"
        "- 农历、节气、节假日安排等**衍生信息**可以联网查询，但必须先锚定上述公历日期再检索，"
        "且不得让搜索结果反过来覆盖本机日期。\n"
        "- 需要在回答中显式核对时间时，可调用 `get_current_datetime` 工具获取结构化结果。\n\n"
    )
