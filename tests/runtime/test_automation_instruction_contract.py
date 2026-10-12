#!/usr/bin/env python3
"""Language of the auto-injected scheduled-task execution contract.

Author: Damon Li
"""

from agenticx.runtime.meta_tools import _augment_automation_instruction_with_contract

_PREFLIGHT = {
    "strategy": "Use firecrawl_scrape with a single url.",
    "hints": [],
}


def test_english_instruction_gets_english_contract():
    instruction = (
        "## Task\n"
        "Write the A-Stock close price and volume daily report in English.\n"
    )
    out = _augment_automation_instruction_with_contract(
        instruction,
        preflight=_PREFLIGHT,
    )
    assert out.startswith("## Execution Contract (Auto Injected)\n")
    assert "This is an execution task, not a planning discussion." in out
    assert "这是执行任务" not in out
    assert "时间窗口必须严格限定" not in out
    assert "Preflight strategy: Use firecrawl_scrape with a single url." in out
    assert out.endswith(instruction.strip())


def test_chinese_instruction_keeps_chinese_contract():
    instruction = "抓取最近公告并写成中文日报。"
    out = _augment_automation_instruction_with_contract(
        instruction,
        preflight={"strategy": "", "hints": ["firecrawl_scrape supports single url only"]},
    )
    assert "这是执行任务，不是方案讨论。" in out
    assert "预检策略: 仅使用已连接的爬虫 MCP 工具。" in out
    assert "- 预检提示:" in out
    assert "This is an execution task" not in out
    assert out.endswith(instruction)


def test_rewrite_replaces_a_previous_chinese_contract():
    stale = (
        "## Execution Contract (Auto Injected)\n"
        "- 这是执行任务，不是方案讨论。禁止输出“是否按此方案执行”。\n"
        "- 时间窗口必须严格限定在最近 7 天，无法解析日期的条目直接丢弃。\n"
        "\n"
        "## Task\n"
        "Produce the daily close-price report in English only.\n"
    )
    out = _augment_automation_instruction_with_contract(stale, preflight=_PREFLIGHT)
    assert out.count("## Execution Contract (Auto Injected)") == 1
    assert "这是执行任务" not in out
    assert "This is an execution task, not a planning discussion." in out
    assert "Produce the daily close-price report in English only." in out


def test_chinese_directory_name_does_not_flip_an_english_task():
    instruction = (
        "Run /Users/damon/Desktop/machi定时任务测试_a/report.py "
        "and write the English daily briefing."
    )
    out = _augment_automation_instruction_with_contract(
        instruction,
        preflight=_PREFLIGHT,
    )
    assert "This is an execution task, not a planning discussion." in out
    assert "这是执行任务" not in out
