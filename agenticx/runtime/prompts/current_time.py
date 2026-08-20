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
    """Build the system-prompt time section. Stable for a whole local day.

    这一段住在 system prompt 的最前面，也就是 prompt 前缀缓存的必经之路。原来它
    打印的是 ``%Y-%m-%d %H:%M:%S`` —— 精确到秒。于是**什么状态都不改**、隔一秒
    重新构建一次，两份 prompt 就在第 3416 个字符处分叉：后面 9000 多 token 的
    system prompt 加上整段对话历史，每个请求都按全价重算，Anthropic 的显式
    ``cache_control`` 和 DeepSeek/Qwen/Kimi/GLM/OpenAI 的自动前缀缓存一起失效。

    时刻本身对 system prompt 没有价值：需要"现在几点"时模型会调
    ``get_current_datetime``（见下方规则），而"今天几号/星期几/今年"这些真正会
    被问到的锚点只需要日期。所以这里只留日期——**一整天字节不变**——精确时刻交给
    每轮尾部注入的 :func:`build_current_time_reminder`，它待在历史之后，改动不会
    往前污染缓存。
    """
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
        "- 需要在回答中显式核对时间时，可调用 `get_current_datetime` 工具获取结构化结果。\n\n"
    )


def build_current_time_reminder() -> str:
    """One line carrying the precise local clock, for tail injection.

    与 :func:`build_current_time_block` 相反，这一行是易变的，所以它只能出现在
    对话历史**之后**（见 ``agenticx.runtime.prompts.session_context``）。
    """
    facts = get_current_time_facts()
    return f"当前时刻：{facts['local_iso']}（{facts['weekday_cn']}）"
