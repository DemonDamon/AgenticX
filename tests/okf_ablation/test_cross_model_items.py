"""跨模型实验的离线断言：不调模型，只保证实验设计的硬约束成立。

上一版实验失效的根因是"对照组不盲"和"空回答被解析成标签"，这里把两条钉死。
"""

from __future__ import annotations

try:
    from tests.okf_ablation.cross_model_consistency import (
        ARMS, CUE_WORDS, ITEMS, TODAY, build_prompt, parse, render_fragment,
    )
except ImportError:
    from cross_model_consistency import (
        ARMS, CUE_WORDS, ITEMS, TODAY, build_prompt, parse, render_fragment,
    )


def test_item_set_is_balanced():
    kinds = [it["kind"] for it in ITEMS]
    assert kinds.count("deprecated") == kinds.count("expired") == kinds.count("valid") == 6


def test_blind_rendering_leaks_no_status_cue():
    """对照组必须真盲：不给户口时，正文和标题里不能有任何状态字样。"""
    for item in ITEMS:
        text = render_fragment(item, "blind")
        assert text == f"# {item['title']}\n\n{item['body']}"
        for cue in CUE_WORDS:
            assert cue not in text, f"{item['id']} 的正文泄露了状态字样：{cue}"
        for cue in CUE_WORDS:
            assert cue not in item["question"], f"{item['id']} 的问题泄露了状态字样：{cue}"


def test_only_difference_between_arms_is_the_frontmatter():
    for item in ITEMS:
        body = render_fragment(item, "blind")
        for arm in ("meta", "guide"):
            assert render_fragment(item, arm).endswith(body)
            assert render_fragment(item, arm).startswith("---\n")


def test_frontmatter_states_the_ground_truth():
    for item in ITEMS:
        fm = render_fragment(item, "meta").split("---\n")[1]
        if item["kind"] == "deprecated":
            assert "status: deprecated" in fm and "stale_after" not in fm
        else:
            assert "status: stable" in fm
            assert (item["stale_after"] < TODAY) == (item["kind"] == "expired")


def test_prompt_states_today_and_guide_only_in_guide_arm():
    item = ITEMS[0]
    for arm in ARMS:
        prompt = build_prompt(item, arm)
        assert TODAY in prompt
        assert ("status 为 deprecated" in prompt) == (arm == "guide")


def test_parse_takes_the_last_verdict_and_never_invents_one():
    assert parse("判定=不可用\n答案=无法回答") == ("不可用", "无法回答")
    assert parse("分析：若可用……\n**判定：可用**\n答案：48小时") == ("可用", "48小时")
    # 同义写法归一
    assert parse('判定="不可用"\n答案=无法回答') == ("不可用", "无法回答")
    assert parse("判定=禁用\n答案=无法回答")[0] == "不可用"
    # 空回答、没有判定的回答：返回 None，由调用方记为失败，不能回退成某个标签
    assert parse("")[0] is None
    assert parse("这条知识看起来不能用了")[0] is None
