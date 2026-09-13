#!/usr/bin/env python3
"""Current local time blocks injected into agent prompts.

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
    """Build the system-prompt time section. Stable for a whole local day."""
    facts = get_current_time_facts()
    return (
        "## 当前时间（权威，来自本机系统时钟）\n"
        f"- 今天日期：{facts['date']}（{facts['weekday_cn']}，"
        f"时区 {facts['tz_name']} UTC{facts['utc_offset']}）\n"
        "- 回答「今天几号 / 现在几点 / 今年是哪一年 / 距离某日还有多久」等时间问题时，"
        "**必须**以本机时间为唯一权威来源；当前时刻见对话末尾的 `<session-context>`。\n"
        "- **禁止**用 `web_search` 查询当前日期、星期或时刻；网页快照日期不可信，"
        "曾出现搜索结果给出过期日期导致回答错误一年以上的事故。\n"
        "- 农历、节气、节假日安排等**衍生信息**可以联网查询，但必须先锚定上述公历日期再检索，"
        "且不得让搜索结果反过来覆盖本机日期。\n"
        "- 需要精确到时/分/秒（如「现在几点」「距离 X 还有几小时」）时，**必须**调用 "
        "`get_current_datetime` 工具获取；本块只提供日期，不提供时刻。\n\n"
    )


def build_current_time_reminder() -> str:
    """One line carrying the precise local clock, for tail injection."""
    facts = get_current_time_facts()
    return f"当前时刻：{facts['local_iso']}（{facts['weekday_cn']}）"


def build_current_time_rules_block() -> str:
    """Date-free time discipline for prompts that get a ``<session-context>`` tail.

    ``build_current_time_block`` embeds the concrete date, so any system prompt
    using it flips bytes at midnight and voids the whole provider prefix cache
    for the first request of the day. Prompts assembled by AgentRuntime already
    carry the date in the tail clock reminder; they should use this block so the
    static prefix stays byte-stable across days.
    """
    return (
        "## 当前时间（权威，来自本机系统时钟）\n"
        "- 今天日期与当前时刻见对话末尾的 `<session-context>`；回答「今天几号 / 现在几点 / "
        "今年是哪一年 / 距离某日还有多久」等时间问题时，**必须**以该本机时间为唯一权威来源。\n"
        "- **禁止**用 `web_search` 查询当前日期、星期或时刻；网页快照日期不可信，"
        "曾出现搜索结果给出过期日期导致回答错误一年以上的事故。\n"
        "- 农历、节气、节假日安排等**衍生信息**可以联网查询，但必须先锚定 `<session-context>` 中的"
        "公历日期再检索，且不得让搜索结果反过来覆盖本机日期。\n"
        "- 需要精确到时/分/秒（如「现在几点」「距离 X 还有几小时」）时，**必须**调用 "
        "`get_current_datetime` 工具获取。\n\n"
    )
